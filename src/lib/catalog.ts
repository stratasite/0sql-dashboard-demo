/**
 * The field catalogue that goes into the system prompt.
 *
 * `GET /fields` is the discovery route: it lists what is deployed on the
 * branch, so the prompt describes the model as it is right now rather than as
 * someone wrote it down. Deploy a new measure and the next conversation knows
 * about it, with no prompt to edit.
 *
 * The text is memoized because it has to be byte-identical between requests
 * for the prompt cache to hit.
 */
import { searchFields } from './zsql';

const TTL_MS = 5 * 60 * 1000;

let cached: { text: string; at: number } | null = null;

function render(
  fields: Awaited<ReturnType<typeof searchFields>>,
  kind: 'dimension' | 'measure',
): string {
  return fields
    .filter((f) => f.kind === kind && !f.hidden)
    .map((f) => {
      const notes = [f.data_type, ...(f.tags?.length ? [`tags: ${f.tags.join(', ')}`] : [])];
      return `- ${f.name} (${notes.join('; ')})`;
    })
    .join('\n');
}

export async function fieldCatalog(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.text;

  const fields = await searchFields();
  // Sorted so the bytes do not move when the server reorders its answer.
  fields.sort((a, b) => a.name.localeCompare(b.name));

  const text = [
    '## Dimensions',
    render(fields, 'dimension'),
    '',
    '## Measures',
    render(fields, 'measure'),
  ].join('\n');

  cached = { text, at: Date.now() };
  return text;
}
