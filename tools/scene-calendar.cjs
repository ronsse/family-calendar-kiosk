// What the coming days' calendar may tell the picture. Run INSIDE the wall container by
// tools/scene_context.py (`docker exec -i <container> node - <from> <to> <options.json>`, this
// file on stdin), because the database is a docker volume. Prints one line of JSON.
//
// By default no title leaves this process. Out come category COUNTS and the text of all-day
// `scene:` notes (the one channel a person writes to be sent). Two things are opt-in through the
// options argument:
//
//   titles  the run's ONE-OFF events, title and days, for the scene director to read
//           (household `scenes.shareTitles`). A routine is left out: a title that also appears a
//           week or more away from this occurrence (the wall holds about sixty days ahead) is a
//           weekly lesson or a monthly club, and a ski lesson every Saturday is not news.
//   guests  [{id, names}] from db/guests.json: which visitors the calendar says are here. An
//           event overlapping the window counts when its title has one of a guest's names AND
//           a word that says somebody is coming (VISIT_WORDS, or `visitWords` in the options),
//           both as whole words. Without the second test "Aunt Sam's birthday" put the whole
//           family in the picture on a day nobody was visiting (measured 2026-10-18). Matched
//           here so only ids come out, and visits work with titles off.
//
// WALL_DB overrides the path, for the test (test/unit-g.scene-calendar.test.ts).
const {DatabaseSync} = require("node:sqlite");
const db = new DatabaseSync(process.env.WALL_DB || "/data/wall.db", {readOnly: true});
const [from, to, optionsJson] = process.argv.slice(2);
const opts = optionsJson ? JSON.parse(optionsJson) : {};
const latest = (alias) => `select max(id) from sync_run r2 where r2.source_id = ${alias}.source_id and r2.state = 'promoted'`;
const day = (alias) => `coalesce(${alias}.all_day_start_date, substr(${alias}.starts_at_utc, 1, 10))`;
// The last day an event covers. An all-day end date is exclusive, so a one-day event ends the
// day it starts.
const lastDay = (alias) => `coalesce(date(${alias}.all_day_end_date, '-1 day'), substr(${alias}.ends_at_utc, 1, 10), ${day(alias)})`;
const counts = db.prepare(`
  select a.category, count(*) n from calendar_event e join asset a on a.id = e.icon_asset_id
  where e.sync_run_id = (${latest("e")}) and ${day("e")} between ? and ? group by 1`).all(from, to);
const hints = db.prepare(`
  select e.title from calendar_event e
  where e.sync_run_id = (${latest("e")}) and ${day("e")} between ? and ?
    and e.all_day_start_date is not null and lower(e.title) like 'scene:%'`).all(from, to);
const out = {
  counts: Object.fromEntries(counts.map(r => [r.category, r.n])),
  hints: hints.map(r => r.title.slice(6).trim()).filter(Boolean),
};

// Every event that OVERLAPS the window — a visit that started last Friday is still a visit —
// with whether its title recurs a week or more away (routine).
const overlapping = (opts.titles || opts.guests) ? db.prepare(`
  select trim(e.title) t, ${day("e")} d, ${lastDay("e")} last, e.all_day_start_date is not null all_day,
    exists (
      select 1 from calendar_event o
      where o.sync_run_id = (${latest("o")}) and lower(trim(o.title)) = lower(trim(e.title))
        and abs(julianday(${day("o")}) - julianday(${day("e")})) >= 7) routine
  from calendar_event e
  where e.sync_run_id = (${latest("e")}) and ${day("e")} <= ? and ${lastDay("e")} >= ?
    and lower(e.title) not like 'scene:%'
  order by d, t`).all(to, from) : [];

if (opts.titles) {
  const seen = new Set();
  out.events = overlapping.filter(e => !e.routine).filter(e => {
    const k = `${e.t.toLowerCase()}|${e.d}`;
    return seen.has(k) ? false : (seen.add(k), true);
  }).slice(0, 30).map(e => ({title: e.t, from: e.d, to: e.last, all_day: !!e.all_day}));
  out.routine = new Set(overlapping.filter(e => e.routine).map(e => e.t.toLowerCase())).size;
}

const VISIT_WORDS = ["visit", "visits", "visiting", "visitors", "in town", "arrive", "arrives",
  "arriving", "arrival", "staying", "stay", "stays", "here", "coming", "comes", "come", "sleepover",
  "pick up", "pickup", "airport", "flight", "lands", "landing", "drive in", "driving in"];

if (Array.isArray(opts.guests)) {
  const visitWords = Array.isArray(opts.visitWords) ? opts.visitWords : VISIT_WORDS;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasWord = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w.toLowerCase())}($|[^\\p{L}\\p{N}])`, "u").test(text.toLowerCase());
  out.visitors = opts.guests.map(g => {
    const days = overlapping.filter(e => g.names.some(n => hasWord(e.t, n)) && visitWords.some(w => hasWord(e.t, w)));
    return days.length ? {id: g.id, from: days[0].d, to: days.reduce((m, e) => e.last > m ? e.last : m, days[0].last)} : null;
  }).filter(Boolean);
}
console.log(JSON.stringify(out));
