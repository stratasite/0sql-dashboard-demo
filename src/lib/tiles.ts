/**
 * The dashboard store.
 *
 * A tile is a title, a chart kind and a query spec — never SQL. The SQL is
 * re-planned from the spec on every load, so a tile survives a renamed column,
 * a new join route or a cheaper table appearing in the model.
 *
 * Tiles live in a JSON file so the demo has no database to set up. On a
 * read-only or serverless host the writes fail and the starter dashboard is
 * what you get; point this at your own store when you build the real thing.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChartKind, QuerySpec, Tile } from '@/types';

const file = resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.TILES_PATH ?? 'data/tiles.json',
);

/** The dashboard a fresh clone opens with. Every field name here is in the model. */
const starter: Tile[] = [
  {
    id: 'starter-volume',
    title: 'Contacts per day, last 28 days',
    chart: 'line',
    createdAt: '1970-01-01T00:00:00.000Z',
    spec: {
      name: 'Contacts per day',
      projections: [
        { field: 'Contact Date', decorators: [{ type: 'truncate', grain: 'day' }], order_by: 'asc' },
        { field: 'Contacts' },
      ],
      filters: [{ field: 'Contact Date', predicate: 'greater_than_or_equal_to', value: '28d' }],
    },
  },
  {
    id: 'starter-sites',
    title: 'Contacts by call center',
    chart: 'bar',
    createdAt: '1970-01-01T00:00:01.000Z',
    spec: {
      name: 'Contacts by call center',
      projections: [{ field: 'Call Center' }, { field: 'Contacts', order_by: 'desc' }],
    },
  },
  {
    id: 'starter-resolution',
    title: 'Resolution mix',
    chart: 'bar',
    createdAt: '1970-01-01T00:00:02.000Z',
    spec: {
      name: 'Resolution mix',
      projections: [{ field: 'Ticket Resolution Gate' }, { field: 'Contacts', order_by: 'desc' }],
    },
  },
  {
    id: 'starter-aht',
    title: 'Average handle time by region',
    chart: 'bar',
    createdAt: '1970-01-01T00:00:03.000Z',
    spec: {
      name: 'Average handle time by region',
      projections: [
        { field: 'Call Center Region' },
        // AHT Mins, not Average Contact Duration Secs: handle time is the work
        // the agent did, not the wall clock from arrival to hang-up.
        { field: 'AHT Mins', order_by: 'desc' },
      ],
    },
  },
];

async function save(tiles: Tile[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(tiles, null, 2)}\n`, 'utf8');
}

export async function listTiles(): Promise<Tile[]> {
  try {
    const tiles = JSON.parse(await readFile(file, 'utf8')) as Tile[];
    return Array.isArray(tiles) ? tiles : starter;
  } catch {
    return starter;
  }
}

export async function getTile(id: string): Promise<Tile | undefined> {
  return (await listTiles()).find((t) => t.id === id);
}

export async function addTile(input: {
  title: string;
  chart: ChartKind;
  spec: QuerySpec;
}): Promise<Tile> {
  const tile: Tile = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
  await save([...(await listTiles()), tile]);
  return tile;
}

/** Returns the removed tile, or undefined when nothing matched. */
export async function removeTile(id: string): Promise<Tile | undefined> {
  const tiles = await listTiles();
  const tile = tiles.find((t) => t.id === id);
  if (tile) await save(tiles.filter((t) => t.id !== id));
  return tile;
}

/**
 * Put the tiles in the given order. Ids that are not in the list keep their
 * relative order after the ones that are, so a stale order from one browser
 * cannot drop a tile pinned from another. Returns the new order.
 */
export async function reorderTiles(order: string[]): Promise<Tile[]> {
  const tiles = await listTiles();
  const rank = new Map(order.map((id, index) => [id, index]));
  const sorted = [...tiles].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
  await save(sorted);
  return sorted;
}

export async function renameTile(id: string, title: string): Promise<Tile | undefined> {
  const tiles = await listTiles();
  const tile = tiles.find((t) => t.id === id);
  if (!tile) return undefined;
  tile.title = title;
  await save(tiles);
  return tile;
}
