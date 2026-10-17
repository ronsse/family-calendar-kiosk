// What the coming week's calendar may tell the picture. Run INSIDE the wall container by
// tools/scene_context.py (`docker exec -i <container> node - <from> <to> <headlines.json>`, this
// file on stdin), because the database is a docker volume. Prints one line of JSON.
//
// Titles never leave this process. Out come category COUNTS, the text of all-day `scene:` notes
// (the one channel a person writes to be sent), and at most one HEADLINE: an id and a setting
// id from tools/scene-headlines.json, never the words that matched. The children's names are
// read here from the `child` table for the same reason, and go nowhere either.
//
// WALL_DB overrides the path, for the test (test/unit-g.scene-calendar.test.ts).
const {DatabaseSync} = require("node:sqlite");
const db = new DatabaseSync(process.env.WALL_DB || "/data/wall.db", {readOnly: true});
const [from, to, rulesJson] = process.argv.slice(2);
const latest = (alias) => `select max(id) from sync_run r2 where r2.source_id = ${alias}.source_id and r2.state = 'promoted'`;
const day = (alias) => `coalesce(${alias}.all_day_start_date, substr(${alias}.starts_at_utc, 1, 10))`;
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

// THE HEADLINE. Most weeks have none, and then nothing below changes the picture.
// A ROUTINE IS NOT AN EVENT: a title that also appears a week or more away from this occurrence
// (the wall holds about sixty days ahead) is a weekly lesson or a monthly club, and a ski lesson
// every Saturday must not make every winter picture a ski hill. A one-off — a party, a trip, one
// multi-day all-day event — appears once. A run of separate daily events a week or longer reads
// as routine too; that is the conservative side to fail on.
if (rulesJson) {
  const rules = JSON.parse(rulesJson);
  const names = db.prepare(`select display_name from child where active = 1`).all()
    .map(r => r.display_name.trim()).filter(Boolean);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasWord = (text, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w.toLowerCase())}($|[^\\p{L}\\p{N}])`, "u").test(text);
  const expand = (ws) => ws.flatMap(w => w === "{child}" ? names : [w]);
  const matches = (rule, text, strict) =>
    rule.words.some(w => hasWord(text, w))
    && (!strict || !rule.with || expand(rule.with).some(w => hasWord(text, w)));
  const events = db.prepare(`
    select lower(trim(e.title)) t, ${day("e")} d from calendar_event e
    where e.sync_run_id = (${latest("e")}) and ${day("e")} between ? and ?
      and lower(e.title) not like 'scene:%'
      and not exists (
        select 1 from calendar_event o
        where o.sync_run_id = (${latest("o")}) and lower(trim(o.title)) = lower(trim(e.title))
          and abs(julianday(${day("o")}) - julianday(${day("e")})) >= 7)
    order by d`).all(from, to);
  // A note a person wrote outranks anything inferred, and is taken at its word: `scene: birthday`
  // needs no "party" or child's name beside it, because nobody types that by accident.
  const notes = out.hints.map(h => h.toLowerCase());
  for (const [texts, strict, source] of [[notes, false, "scene note"], [events.map(e => e.t), true, "calendar"]]) {
    const rule = rules.find(r => texts.some(t => matches(r, t, strict)));
    if (rule) {
      out.headline = {id: rule.id, setting: rule.setting, source};
      break;
    }
  }
  out.headline = out.headline || null;
}
console.log(JSON.stringify(out));
