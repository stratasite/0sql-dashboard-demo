/**
 * Builds warehouse/cs_warehouse.duckdb from the Parquet files in warehouse/data.
 *
 * The sample contacts span six months. Every run re-anchors them so the most
 * recent contact lands on today, which keeps relative filters ("28d", "3m")
 * answering with rows no matter when the repo is cloned. Nothing here touches
 * 0sql: the semantic model describes these tables, it does not create them.
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dataDir = join(root, 'warehouse', 'data');
const dbPath = process.env.DUCKDB_PATH
  ? resolve(root, process.env.DUCKDB_PATH)
  : join(root, 'warehouse', 'cs_warehouse.duckdb');

/** Shift the fact's dates so max(fact_utc_date) is today, to the day. */
const SHIFT = `((current_date - (SELECT max(fact_utc_date) FROM src))::INTEGER)`;

const statements = [
  `CREATE OR REPLACE TABLE cs_call_center_d AS
     SELECT * FROM read_parquet('${join(dataDir, 'cs_call_center_d.parquet')}')`,

  `CREATE OR REPLACE TABLE cs_contact_f AS
     WITH src AS (SELECT * FROM read_parquet('${join(dataDir, 'cs_contact_f.parquet')}'))
     SELECT
       * REPLACE (
         fact_utc_date   + ${SHIFT}                          AS fact_utc_date,
         contact_start_ts + to_days(${SHIFT})                 AS contact_start_ts,
         contact_end_ts   + to_days(${SHIFT})                 AS contact_end_ts
       )
     FROM src`,
];

for (const f of ['cs_contact_f.parquet', 'cs_call_center_d.parquet']) {
  if (!existsSync(join(dataDir, f))) {
    console.error(`missing ${join('warehouse', 'data', f)} — this repo ships it; check out the full tree`);
    process.exit(1);
  }
}

mkdirSync(dirname(dbPath), { recursive: true });
// A fresh file every run: the re-anchor is only correct against the Parquet.
for (const suffix of ['', '.wal']) rmSync(dbPath + suffix, { force: true });

const instance = await DuckDBInstance.create(dbPath);
const connection = await instance.connect();

for (const sql of statements) await connection.run(sql);

const reader = await connection.runAndReadAll(`
  SELECT
    (SELECT count(*) FROM cs_contact_f)        AS contacts,
    (SELECT count(*) FROM cs_call_center_d)    AS call_centers,
    (SELECT min(fact_utc_date) FROM cs_contact_f)::VARCHAR AS first_day,
    (SELECT max(fact_utc_date) FROM cs_contact_f)::VARCHAR AS last_day
`);
const [summary] = reader.getRowObjectsJson();
connection.closeSync();

console.log(`seeded ${dbPath}`);
console.log(
  `  cs_contact_f      ${summary.contacts} rows, ${summary.first_day} … ${summary.last_day}`,
);
console.log(`  cs_call_center_d  ${summary.call_centers} rows`);
