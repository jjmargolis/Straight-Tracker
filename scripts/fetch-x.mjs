// Pulls relevant recent X posts about Hormuz shipping attacks, with engagement counts.
// Each run takes the next query from scripts/x-queries.json (precise + wide-net, 5 languages,
// from research/source-catalog.md), so four runs a day cycle through all of them every ~3 days.
// Needs env X_BEARER_TOKEN (repo secret). Pay-per-use: every post returned is billed
// (~$0.005 each, Oct 2026), so a hard monthly budget is enforced via data/x_budget.json.
//
// Writes data/x_posts.csv, merged by post id; engagement is refreshed when a post reappears.
import fs from "node:fs";
import { readCSV, writeCSV } from "./lib.mjs";

const MONTHLY_CAP = 1800;   // posts read per month (~$9 at $0.005)
const PER_RUN = 15;         // four runs a day -> ~1,800/month
const QUERIES = JSON.parse(fs.readFileSync(new URL("./x-queries.json", import.meta.url), "utf8"));

const token = process.env.X_BEARER_TOKEN?.trim();
if (!token) { console.log("X_BEARER_TOKEN not set; skipping X fetch."); process.exit(0); }
if (/\s/.test(token)) throw new Error("X_BEARER_TOKEN contains spaces or line breaks. Save only the Bearer Token (one line) in the repo secret.");

const BPATH = "data/x_budget.json";
const month = new Date().toISOString().slice(0, 7);
let budget = fs.existsSync(BPATH) ? JSON.parse(fs.readFileSync(BPATH, "utf8")) : {};
if (budget.month !== month) budget = { month, reads: 0, cap: MONTHLY_CAP };
const n = Math.min(PER_RUN, MONTHLY_CAP - budget.reads);
if (n < 10) { console.log(`Monthly X budget reached (${budget.reads}/${MONTHLY_CAP}); skipping.`); process.exit(0); }

const Q = QUERIES[(budget.next ?? 0) % QUERIES.length];
budget.next = ((budget.next ?? 0) + 1) % QUERIES.length;

async function search(query) {
  const params = new URLSearchParams({
    query, max_results: String(Math.max(10, n)), sort_order: "relevancy",
    "tweet.fields": "created_at,public_metrics,lang,author_id,attachments",
    expansions: "author_id,attachments.media_keys",
    "user.fields": "username,name,verified",
    "media.fields": "type,preview_image_url,url",
  });
  const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { authorization: `Bearer ${token}` } });
  return { res, j: await res.json() };
}
if (!/min_(reposts|likes):\d*[1-9]/.test(Q.q)) throw new Error(`${Q.id} has no engagement floor; refusing to spend reads on it.`);
let { res, j } = await search(Q.q);
// Every query carries an engagement floor (Jacob: no zero-engagement reads). min_reposts: is documented but
// untested on pay-per-use; if X rejects it, try the same floor as min_likes (x3). Never fall back to no floor.
// A rejected query returns no posts, so a retry costs nothing.
if (res.status === 400) {
  console.log(`X rejected ${Q.id} (${JSON.stringify(j).slice(0, 200)}); retrying with min_likes.`);
  ({ res, j } = await search(Q.q.replace(/min_reposts:(\d+)/, (_, n) => `min_likes:${n * 3}`)));
}
if (!res.ok) { fs.writeFileSync(BPATH, JSON.stringify(budget, null, 2) + "\n"); throw new Error(`X API HTTP ${res.status} on ${Q.id}: ${JSON.stringify(j).slice(0, 300)}`); }

const posts = j.data ?? [];
// Check X actually applied the floor (if it silently ignored the operator, we'd be paying for low-engagement posts).
const floor = +(Q.q.match(/min_reposts:(\d+)/)?.[1] ?? 0);
const below = posts.filter((p) => (p.public_metrics?.retweet_count ?? 0) < floor).length;
if (below) console.log(`WARNING: ${below}/${posts.length} posts from ${Q.id} are under min_reposts:${floor}; the operator may be ignored.`);
budget.reads += posts.length;
budget.updated = new Date().toISOString();
fs.writeFileSync(BPATH, JSON.stringify(budget, null, 2) + "\n");

const users = new Map((j.includes?.users ?? []).map((u) => [u.id, u]));
const media = new Map((j.includes?.media ?? []).map((m) => [m.media_key, m]));
const PATH = "data/x_posts.csv";
const HEAD = ["id", "created_at", "username", "name", "text", "lang", "views", "likes", "reposts", "replies", "media_type", "preview", "url", "fetched_at", "query"];
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
    url: `https://x.com/${u.username ?? "i"}/status/${p.id}`, fetched_at: now, query: Q.id,
  });
}
const rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2000);
writeCSV(PATH, HEAD, rows);
console.log(`X ${Q.id} (${Q.label}): ${posts.length} posts read (month total ${budget.reads}/${MONTHLY_CAP}); file has ${rows.length}.`);
