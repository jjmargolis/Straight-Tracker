// Daily news-coverage volume for Hormuz attacks from the GDELT DOC 2.0 API (free, no key).
// Writes data/coverage_gdelt.csv (date,articles,total), merging with what is already there so
// history survives GDELT's ~3-month lookback. Also writes data/gdelt_articles.csv: the most
// recent matching articles, for the media feed.
import { readCSV, writeCSV } from "./lib.mjs";

const QUERY = '(hormuz OR "gulf of oman") (tanker OR ship OR vessel OR sank OR sunk) (attack OR strike OR missile OR drone OR mine)';
const API = "https://api.gdeltproject.org/api/v2/doc/doc";
const WAR_START = "20260228000000";
const stamp = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

// GDELT asks for at most one request every 5 seconds and answers 429 otherwise
// (shared CI IPs can hit this too), so pace every call and back off on 429.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(params) {
  const url = `${API}?${new URLSearchParams({ query: QUERY, format: "json", ...params })}`;
  for (let attempt = 1; ; attempt++) {
    await sleep(attempt === 1 ? 6000 : 15000 * attempt);
    const res = await fetch(url, { headers: { "user-agent": "straight-tracker (github.com/jjmargolis/straight-tracker)" } });
    const text = await res.text();
    if (res.status === 429 && attempt < 5) { console.warn(`GDELT 429, retry ${attempt}`); continue; }
    if (!res.ok) throw new Error(`GDELT HTTP ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { throw new Error(`GDELT non-JSON: ${text.slice(0, 200)}`); }
  }
}

// 1) Volume timeline. Fetch from war start (beyond 3 months is best effort), fall back to 90 days.
let tl;
try { tl = await get({ mode: "timelinevolraw", startdatetime: WAR_START, enddatetime: stamp(new Date()), timelinesmooth: "0" }); }
catch (e) { console.warn(`Full-range timeline failed (${e.message}); using 3 months`); tl = await get({ mode: "timelinevolraw", timespan: "3months", timelinesmooth: "0" }); }
const series = tl.timeline?.[0]?.data;
if (!series?.length) throw new Error(`GDELT timeline empty: ${JSON.stringify(tl).slice(0, 300)}`);

const PATH = "data/coverage_gdelt.csv";
const byDate = new Map(readCSV(PATH).rows.map((r) => [r.date, r]));
for (const p of series) {
  const d = String(p.date);
  const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  byDate.set(date, { date, articles: p.value, total: p.norm ?? "" });
}
const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
writeCSV(PATH, ["date", "articles", "total"], rows);
console.log(`coverage: ${rows.length} days, ${rows[0].date} to ${rows.at(-1).date}`);

// 2) Latest articles (up to 75), newest first.
const al = await get({ mode: "artlist", maxrecords: "75", sort: "datedesc", timespan: "7days" });
const arts = (al.articles ?? []).map((a) => ({
  seendate: String(a.seendate ?? "").replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z"),
  title: a.title, url: a.url, domain: a.domain, language: a.language, sourcecountry: a.sourcecountry, image: a.socialimage ?? "",
}));
writeCSV("data/gdelt_articles.csv", ["seendate", "title", "url", "domain", "language", "sourcecountry", "image"], arts);
console.log(`articles: ${arts.length}`);
