// Free news: Google News search RSS in five languages, maritime and Gulf outlets' own RSS (filtered by
// match.mjs), and the straits.live event log. No keys. Replaces GDELT's article list, which GDELT
// often refuses to GitHub runners (HTTP 429) and which matched off-topic stories.
// Writes data/news.csv: last 7 days, de-duplicated by headline, newest first.
import fs from "node:fs";
import { readCSV, writeCSV, parseCSV } from "./lib.mjs";
import { relevant } from "./match.mjs";

const { googleNews, rss, events } = JSON.parse(fs.readFileSync(new URL("./free-feeds.json", import.meta.url), "utf8"));
const PATH = "data/news.csv", KEEP_DAYS = 7, MAX = 600;
const HEAD = ["published", "title", "source", "url", "lang", "feed", "kind", "severity", "fetched_at"];
const UA = "Mozilla/5.0 (compatible; straight-tracker/1.0; +https://github.com/jjmargolis/straight-tracker)";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rlm: "", lrm: "" };   // rlm/lrm: invisible direction marks common in Persian posts
const decode = (s) => s.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ""), e[1]?.toLowerCase() === "x" ? 16 : 10)) : ENT[e] ?? m);
const tag = (s, t) => { const m = s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).replace(/<[^>]+>/g, "").trim() : ""; };
const iso = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };
async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const items = (xml) => xml.split(/<item[\s>]/).slice(1).map((it) => ({ title: tag(it, "title"), url: tag(it, "link") || (it.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] || "", published: iso(tag(it, "pubDate") || tag(it, "dc:date")), source: tag(it, "source") }));

const now = new Date().toISOString();
const out = [], problems = [];
for (const g of googleNews) {
  const url = `https://news.google.com/rss/search?${new URLSearchParams({ q: `${g.q} when:2d`, hl: g.hl, gl: g.gl, ceid: g.ceid })}`;
  try {
    for (const it of items(await get(url))) {
      // Google appends " - Source" to each title.
      const title = it.source && it.title.endsWith(` - ${it.source}`) ? it.title.slice(0, -(it.source.length + 3)) : it.title;
      out.push({ ...it, title, lang: g.lang, feed: "Google News", kind: "article" });
    }
  } catch (e) { problems.push(`Google News ${g.lang}: ${e.message}`); }
}
for (const f of rss) {
  try { for (const it of items(await get(f.url))) if (relevant(it.title)) out.push({ ...it, source: f.name, lang: "en", feed: f.name, kind: "article" }); }
  catch (e) { problems.push(`${f.name}: ${e.message}`); }
}
try {
  for (const e of parseCSV(await get(events.url)).rows) {
    out.push({ published: iso(e.occurred_at_iso), title: e.title, source: e.source_name, url: e.source_url, lang: "", feed: events.name, kind: "event", severity: e.severity });
  }
} catch (e) { problems.push(`${events.name}: ${e.message}`); }

const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 80);
const seen = new Map();
for (const r of [...readCSV(PATH).rows, ...out.map((r) => ({ ...r, fetched_at: now }))]) {
  if (!r.title || !r.url || !r.published) continue;
  const k = norm(r.title), old = seen.get(k);
  // Keep the first sighting; an event row wins over an article with the same headline (it carries severity).
  if (!old || (r.kind === "event" && old.kind !== "event")) seen.set(k, { ...r, fetched_at: old?.fetched_at ?? r.fetched_at });
}
const cutoff = Date.now() - KEEP_DAYS * 864e5;
const rows = [...seen.values()].filter((r) => Date.parse(r.published) >= cutoff && Date.parse(r.published) <= Date.now() + 36e5)
  .sort((a, b) => b.published.localeCompare(a.published)).slice(0, MAX);
writeCSV(PATH, HEAD, rows);
console.log(`News: ${out.length} items fetched, ${rows.length} kept (${rows.filter((r) => r.kind === "event").length} events).`);
if (problems.length) console.warn(`News problems: ${problems.join("; ")}`);
if (problems.length >= googleNews.length + rss.length) process.exit(1);
