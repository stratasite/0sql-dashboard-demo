/**
 * The field catalogue that goes into the system prompt.
 *
 * `GET /fields` is the discovery route: it lists what is deployed on the
 * branch, so the prompt describes the model as it is right now rather than as
 * someone wrote it down. Deploy a new measure and the next conversation knows
 * about it, with no prompt to edit.
 *
 * It is curated, because the model is bigger than the prompt should be: 532
 * fields across 26 tables, most of them dimensions on subject areas a given
 * question will never touch. Two rules decide what goes inline.
 *
 * Every **measure** does, grouped by the table it belongs to. Measures are the
 * scarce half — there are a hundred of them, they carry the business
 * definitions, and which fact a measure sits on is exactly what the agent needs
 * to know before combining two of them.
 *
 * **Dimensions** go inline for the contact star and are named by table
 * elsewhere. A dimension is easy to find by guessing its name ("region",
 * "skill", "tenure"), which is what `search_fields` is for, and listing 350 of
 * them inline buys nothing but tokens.
 *
 * Note what this is *not*: `hidden: true` in the model would drop a field from
 * `/fields` altogether, which hides it from `search_fields` too and makes it
 * genuinely unreachable. Curating here keeps every field discoverable.
 *
 * The text is memoized because it has to be byte-identical between requests
 * for the prompt cache to hit.
 */
import { searchFields } from './zsql';
import type { Field } from '@/types';

const TTL_MS = 5 * 60 * 1000;

/**
 * The contact star: the fact and what hangs directly off it. A customer service
 * question almost always lands here, so these are listed in full.
 */
const CORE_TABLES = new Set([
  'contact',
  'call-center',
  'escalating-call-center',
  'contact-skill',
  'contact-subchannel',
  'transfer-type',
  'country',
  'recontact',
  'agent-history',
]);

let cached: { text: string; at: number } | null = null;

/** Table slug a field is listed under. Sorted, so a multi-table field is stable. */
function homeTable(field: Field): string {
  return [...field.tables].sort()[0] ?? 'unknown';
}

function line(field: Field): string {
  const notes = [field.data_type, ...(field.tags?.length ? [`tags: ${field.tags.join(', ')}`] : [])];
  return `- ${field.name} (${notes.join('; ')})`;
}

function byTable(fields: Field[]): Map<string, Field[]> {
  const groups = new Map<string, Field[]>();
  for (const field of fields) {
    const table = homeTable(field);
    if (!groups.has(table)) groups.set(table, []);
    groups.get(table)!.push(field);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

export async function fieldCatalog(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text;

  const fields = await searchFields();
  // Sorted so the bytes do not move when the server reorders its answer.
  fields.sort((a, b) => a.name.localeCompare(b.name));

  const visible = fields.filter((f) => !f.hidden);
  const measures = visible.filter((f) => f.kind === 'measure');
  const dimensions = visible.filter((f) => f.kind === 'dimension');
  const coreDimensions = dimensions.filter((f) => CORE_TABLES.has(homeTable(f)));
  const otherDimensions = dimensions.filter((f) => !CORE_TABLES.has(homeTable(f)));

  const out: string[] = [];

  out.push('## Measures, by the table they belong to');
  out.push(
    'Measures from different tables combine only where the model joins them. Prefer a published measure to deriving one.',
  );
  for (const [table, group] of byTable(measures)) {
    out.push('', `### ${table}`, ...group.map(line));
  }

  out.push('', '## Dimensions on the contact star');
  for (const [table, group] of byTable(coreDimensions)) {
    out.push('', `### ${table}`, ...group.map(line));
  }

  if (otherDimensions.length > 0) {
    const counts = [...byTable(otherDimensions)]
      .map(([table, group]) => `${table} (${group.length})`)
      .join(' · ');
    out.push(
      '',
      '## Dimensions on other tables',
      `Not listed here — call \`search_fields\` for them, by name or by what they describe. ${otherDimensions.length} fields across: ${counts}`,
    );
  }

  const text = out.join('\n');
  cached = { text, at: Date.now() };
  return text;
}
