/**
 * Propose categories for the calendar events the built-in vocabulary declines — for a HUMAN
 * to read. It writes nothing, ever.
 *
 *   docker exec -i family-calendar-wall sh -c 'cat > /app/suggest.ts' < tools/suggest-event-words.ts
 *   docker exec family-calendar-wall node --experimental-strip-types /app/suggest.ts
 *
 * Into `/app` and not `/tmp`: node resolves `better-sqlite3` by walking up from the script,
 * and from `/tmp` it never reaches `/app/node_modules`. `tools/` is not in the image on
 * purpose — this is a thing you run when you want it, not a thing the wall ships.
 *
 * ## Why this is a tool and not a feature
 *
 * H5 §6b designed a local Ollama classifier feeding the icon vocabulary. Measured on
 * 2026-08-29 its premise holds: against the keyword table's own high-precision labels
 * `hermes3:8b` agreed 21 of 23, and on the 25 titles the table declines, hermes3 and
 * llama3.2 — different model families — both labelled 20 and agreed with each other on all
 * 20. The signal is real.
 *
 * What could NOT be measured is whether those 20 labels are RIGHT, because checking that
 * means reading the household's event titles, and those do not go to a hosted model
 * (build-plan.md §3.1). So this prints them for the one reader who can check them.
 *
 * It stops there deliberately. Wiring an 8B model straight to the icon a pre-reader sees
 * would put a picture on her wall that nobody ever read — the confidently-wrong output this
 * project refuses everywhere else, and she is the reader who cannot check it against the
 * words. A proposal a person approves is a different object from a prediction.
 *
 * ## And the household's own words cannot live in the repo
 *
 * The declined titles are names and places — 24 of 25 contain none of ~70 candidate generic
 * words. So the rules that would catch them are household-specific, which puts them on the
 * wrong side of the redaction rule: `src/calendar/classify.ts` is committed and must stay
 * generic. If this turns out to be worth automating, the words belong in the database beside
 * `db/household.sql`, not in TypeScript. That is a design decision and it is not made here.
 */

import Database from 'better-sqlite3';
import { classifyEventTitle, EVENT_CATEGORIES } from '/app/src/calendar/classify.ts';

const DB_PATH = process.env['WALL_DB'] ?? '/data/wall.db';
const OLLAMA = process.env['OLLAMA_URL'] ?? 'http://localhost:11434';
/** Two families, not two checkpoints: agreement between them is worth something. */
const MODELS = ['hermes3:8b', 'llama3.2:3b'];

const VOCAB: readonly string[] = EVENT_CATEGORIES;
const SYSTEM =
  `You label family-calendar entries for a children's wall display. Answer with EXACTLY ONE ` +
  `word from this list and nothing else: ${VOCAB.join(', ')}, none.\n\n` +
  `Answer "none" unless you are confident. A wrong picture beside an event is worse than no ` +
  `picture, because the child reading it cannot check it against the words.`;

async function ask(title: string, model: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: title },
        ],
      }),
    });
  } catch {
    return 'unreachable';
  }
  if (!res.ok) return 'unreachable';
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = (body.choices?.[0]?.message?.content ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  // Whitelisted to the closed vocabulary, so a model cannot answer with prose — or with a
  // fragment of the title it was given.
  return VOCAB.includes(raw) ? raw : 'none';
}

const db = new Database(DB_PATH, { readonly: true });
const rows = db
  .prepare(
    `SELECT e.title AS title FROM calendar_event e
       JOIN calendar_source s ON s.current_sync_run_id = e.sync_run_id
      ORDER BY e.title`,
  )
  .all() as { title: string }[];

const declined = [...new Set(rows.map((r) => r.title))].filter((t) => classifyEventTitle(t) === null);

console.log(`${rows.length} events in the promoted generation.`);
console.log(`${declined.length} distinct titles the built-in vocabulary declines.\n`);
if (declined.length === 0) process.exit(0);

const width = Math.min(52, Math.max(...declined.map((t) => t.length)));
console.log(`${'title'.padEnd(width)}  ${MODELS.map((m) => m.padEnd(12)).join('')}`);
console.log('-'.repeat(width + 2 + MODELS.length * 12));

let agreed = 0;
for (const title of declined) {
  const answers: string[] = [];
  for (const model of MODELS) answers.push(await ask(title, model));
  const [a, b] = answers;
  const both = a !== 'none' && a === b;
  if (both) agreed += 1;
  const mark = both ? ' <=' : '';
  console.log(
    `${title.slice(0, width).padEnd(width)}  ${answers.map((x) => x.padEnd(12)).join('')}${mark}`,
  );
}

console.log(`\n${agreed} of ${declined.length} have both models agreeing on a real category (<=).`);
console.log('Nothing was written. To act on one, add a generic word to the table in');
console.log('src/calendar/classify.ts — and NOT a name, a place, or anything household-specific.');
