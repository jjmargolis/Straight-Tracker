// Daily news-coverage volume for Hormuz attacks from the GDELT DOC 2.0 API (free, no key).
// Writes data/coverage_gdelt.csv (date,articles,total), merging by date so history accumulates.
//
// GDELT allows one request per 5 s per IP and often answers GitHub's shared runner IPs with 429
// (seen in this repo's runs, 2026-11-06). So each run makes ONE small request (last 7 days),
// retries a few times, and gives up quietly: any later run fills the gap, because 7 days overlap.
// The article list now comes from scripts/fetch-news.mjs (Google News + outlet RSS).
import { readCSV, writeCSV } from "./lib.mjs";

const QUERY = '(hormuz OR "gulf of oman") (tanker OR ship OR vessel OR sank OR sunk) (attack OR strike OR missile OR drone OR mine)';
const URL_ = `https://api.gdeltproject.org/api/v2/doc/doc?${new URLSearchParams({ query: QUERY, format: "json", mode: "timelinevolraw", timespan: "7d", timelinesmooth: "0" })}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tl;
for (let attempt = 1; attempt <= 4 && !tl; attempt++) {
  if (attempt > 1) await sleep(20000 * attempt);
  try {
    const res = await fetch(URL_, { headers: { "user-agent": "straight-tracker (github.com/jjmargolis/straight-tracker)" }, signal: AbortSignal.timeout(40000) });
    const text = await res.text();
    if (res.status === 429) { console.warn(`GDELT 429 (attempt ${attempt})`); continue; }
    if (!res.ok) { console.warn(`GDELT HTTP ${res.status}: ${text.slice(0, 120)}`); continue; }
    tl = JSON.parse(text);
  } catch (e) { console.warn(`GDELT attempt ${attempt}: ${e.cause?.code ?? e.message}`); }
}
if (!tl) { console.warn("GDELT unavailable this run; coverage unchanged."); process.exit(0); }

const series = tl.timeline?.[0]?.data ?? [];
if (!series.length) { console.warn(`GDELT timeline empty: ${JSON.stringify(tl).slice(0, 200)}`); process.exit(0); }
// Bins may be finer than a day: sum per UTC date. The first date is partial (the window starts
// mid-day), so it is not allowed to overwrite a fuller value already on file.
const day = new Map();
for (const p of series) {
  const d = String(p.date), date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const v = day.get(date) ?? { date, articles: 0, total: 0 };
  v.articles += +p.value || 0; v.total += +p.norm || 0; day.set(date, v);
}
const PATH = "data/coverage_gdelt.csv";
const byDate = new Map(readCSV(PATH).rows.map((r) => [r.date, r]));
const dates = [...day.keys()].sort();
for (const [date, v] of day) {
  if (date === dates[0] && byDate.has(date)) continue;
  byDate.set(date, v);
}
const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
writeCSV(PATH, ["date", "articles", "total"], rows);
console.log(`GDELT: ${series.length} bins over ${day.size} days; file has ${rows.length} days (${rows[0].date} to ${rows.at(-1).date}).`);
