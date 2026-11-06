// Pulls the most relevant recent X posts about Hormuz attacks, with engagement counts.
// Needs env X_BEARER_TOKEN (repo secret). Pay-per-use: every post returned is billed
// (~$0.005 each, Oct 2026), so a hard monthly budget is enforced via data/x_budget.json.
//
// Writes data/x_posts.csv, merged by post id; engagement is refreshed when a post reappears.
import fs from "node:fs";
import { readCSV, writeCSV } from "./lib.mjs";

const MONTHLY_CAP = 1800;   // posts read per month (~$9 at $0.005)
const PER_RUN = 50;         // one run a day -> ~1,550/month
const QUERY = '(hormuz OR "gulf of oman") (tanker OR ship OR vessel OR sank OR strike OR attack OR missile OR drone) has:media -is:retweet';

const token = process.env.X_BEARER_TOKEN?.trim();
if (!token) { console.log("X_BEARER_TOKEN not set; skipping X fetch."); process.exit(0); }
if (/\s/.test(token)) throw new Error("X_BEARER_TOKEN contains spaces or line breaks. Save only the Bearer Token (one line) in the repo secret.");

const BPATH = "data/x_budget.json";
const month = new Date().toISOString().slice(0, 7);
let budget = fs.existsSync(BPATH) ? JSON.parse(fs.readFileSync(BPATH, "utf8")) : {};
if (budget.month !== month) budget = { month, reads: 0, cap: MONTHLY_CAP };
const n = Math.min(PER_RUN, MONTHLY_CAP - budget.reads);
if (n < 10) { console.log(`Monthly X budget reached (${budget.reads}/${MONTHLY_CAP}); skipping.`); process.exit(0); }

const params = new URLSearchParams({
  query: QUERY, max_results: String(n), sort_order: "relevancy",
  "tweet.fields": "created_at,public_metrics,lang,author_id,attachments",
  expansions: "author_id,attachments.media_keys",
  "user.fields": "username,name,verified",
  "media.fields": "type,preview_image_url,url",
});
const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { authorization: `Bearer ${token}` } });
const j = await res.json();
if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);

const posts = j.data ?? [];
budget.reads += posts.length;
budget.updated = new Date().toISOString();
fs.writeFileSync(BPATH, JSON.stringify(budget, null, 2) + "\n");

const users = new Map((j.includes?.users ?? []).map((u) => [u.id, u]));
const media = new Map((j.includes?.media ?? []).map((m) => [m.media_key, m]));
const PATH = "data/x_posts.csv";
const HEAD = ["id", "created_at", "username", "name", "text", "lang", "views", "likes", "reposts", "replies", "media_type", "preview", "url", "fetched_at"];
const byId = new Map(readCSV(PATH).rows.map((r) => [r.id, r]));
const now = new Date().toISOString();
for (const p of posts) {
  const u = users.get(p.author_id) ?? {};
  const m = media.get(p.attachments?.media_keys?.[0]) ?? {};
  const pm = p.public_metrics ?? {};
  byId.set(p.id, {
    id: p.id, created_at: p.created_at, username: u.username ?? "", name: u.name ?? "",
    text: p.text.replace(/\s+/g, " "), lang: p.lang ?? "",
    views: pm.impression_count ?? "", likes: pm.like_count ?? "", reposts: (pm.retweet_count ?? 0) + (pm.quote_count ?? 0), replies: pm.reply_count ?? "",
    media_type: m.type ?? "", preview: m.preview_image_url ?? m.url ?? "",
    url: `https://x.com/${u.username ?? "i"}/status/${p.id}`, fetched_at: now,
  });
}
const rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2000);
writeCSV(PATH, HEAD, rows);
console.log(`X: ${posts.length} posts read (month total ${budget.reads}/${MONTHLY_CAP}); file has ${rows.length}.`);
