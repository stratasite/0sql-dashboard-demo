/**
 * Builds warehouse/cs_warehouse.duckdb from the Parquet files in warehouse/data.
 *
 * Why Parquet and not a committed .duckdb: the database is a build output. It
 * is rewritten on every seed, it is ~9x the size of the same data in Parquet
 * (55 MB against 6 MB), and a binary that changes every run is the last thing
 * that belongs in git history. The Parquet files never change, which is also
 * what makes this script idempotent — every table is rebuilt from source, so
 * running it twice lands in exactly the same place.
 *
 * The sample spans six months. Every run re-anchors it so the most recent
 * contact lands on today, which keeps relative filters ("28d", "3m") answering
 * with rows no matter when the repo is cloned. One shift, derived from the
 * contact fact, is applied to every date and timestamp in every table: the
 * tables join on dates (an agent's roster day, a membership snapshot), so
 * moving them by different amounts would quietly empty those joins.
 *
 * Nothing here touches 0sql: the semantic model describes these tables, it does
 * not create them.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dataDir = join(root, 'warehouse', 'data');
const dbPath = process.env.DUCKDB_PATH
  ? resolve(root, process.env.DUCKDB_PATH)
  : join(root, 'warehouse', 'cs_warehouse.duckdb');

/** The fact whose latest row defines "today". */
const ANCHOR = { table: 'cs_contact_f', column: 'fact_utc_date' };

const files = readdirSync(dataDir).filter((f) => f.endsWith('.parquet')).sort();
if (files.length === 0) {
  console.error(`no .parquet files in ${join('warehouse', 'data')} — check out the full tree`);
  process.exit(1);
}
const tables = files.map((f) => basename(f, '.parquet'));
if (!tables.includes(ANCHOR.table)) {
  console.error(`missing ${ANCHOR.table}.parquet — it anchors every other date`);
  process.exit(1);
}

mkdirSync(dirname(dbPath), { recursive: true });
// A fresh file every run: the re-anchor is only correct against the Parquet.
for (const suffix of ['', '.wal']) rmSync(dbPath + suffix, { force: true });

const instance = await DuckDBInstance.create(dbPath);
const connection = await instance.connect();

for (const table of tables) {
  await connection.run(
    `CREATE OR REPLACE TABLE "${table}" AS
       SELECT * FROM read_parquet('${join(dataDir, `${table}.parquet`)}')`,
  );
}

// One shift for the whole warehouse, in days, computed before anything moves.
const shiftRows = await connection.runAndReadAll(
  `SELECT (current_date - max("${ANCHOR.column}"))::INTEGER AS days FROM "${ANCHOR.table}"`,
);
const shift = Number(shiftRows.getRowObjectsJson()[0].days);

const columns = (
  await connection.runAndReadAll(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'main' AND data_type IN ('DATE', 'TIMESTAMP')
    ORDER BY table_name, column_name
  `)
).getRowObjectsJson();

const byTable = new Map();
for (const { table_name, column_name, data_type } of columns) {
  if (!byTable.has(table_name)) byTable.set(table_name, []);
  // A DATE takes a plain day offset; a TIMESTAMP needs it as an interval, and
  // keeps its time of day either way.
  byTable.get(table_name).push(
    data_type === 'DATE'
      ? `"${column_name}" = "${column_name}" + ${shift}`
      : `"${column_name}" = "${column_name}" + to_days(${shift})`,
  );
}

if (shift !== 0) {
  for (const [table, assignments] of byTable) {
    await connection.run(`UPDATE "${table}" SET ${assignments.join(', ')}`);
  }
}

const reader = await connection.runAndReadAll(`
  SELECT
    (SELECT count(*) FROM ${ANCHOR.table})                      AS contacts,
    (SELECT min(${ANCHOR.column}) FROM ${ANCHOR.table})::VARCHAR AS first_day,
    (SELECT max(${ANCHOR.column}) FROM ${ANCHOR.table})::VARCHAR AS last_day
`);
const { contacts, first_day, last_day } = reader.getRowObjectsJson()[0];
const shifted = [...byTable.values()].reduce((n, cols) => n + cols.length, 0);

console.log(
  `seeded ${dbPath}\n` +
    `  ${tables.length} tables, ${contacts} contacts, ${first_day} to ${last_day}\n` +
    `  shifted ${shifted} date columns by ${shift} days`,
);
