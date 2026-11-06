// Pulls relevant recent X posts about Hormuz shipping attacks, with engagement counts.
// Each run takes the next query from scripts/x-queries.json (precise + wide-net, 5 languages,
// from research/source-catalog.md), so four runs a day cycle through all of them every ~3 days.
// Needs env X_BEARER_TOKEN (repo secret). Pay-per-use bills every resource returned, so a hard
// monthly budget is enforced via data/x_budget.json, counted in UNITS of $0.005 (docs.x.com pricing,
// read 2026-11-06): post read 1, media object 1, user read 2. Expanded objects (includes) are
// assumed billed too (planned 22 Nov 2026 per xdevplatform/docs PR #520, unconfirmed): safe side.
// Authors are NOT expanded on every search; unseen authors (or profiles >30 days old) are looked up
// once and cached in data/x_users.csv, which also feeds the account registry (data/accounts.csv).
//
// Writes data/x_posts.csv, merged by post id; engagement is refreshed when a post reappears.
import fs from "node:fs";
import { readCSV, writeCSV } from "./lib.mjs";

const MONTHLY_CAP = 1800;   // units per month (~$9 at $0.005/unit)
const PER_RUN = 15;         // posts per run (max_results)
// Price of each billed resource in $0.005 units, so one counter tracks real dollars, not just posts.
const COST = { post: 1, media: 1, user: 2 };
// Re-read a profile monthly: bios and follower counts drift, but paying $0.010 per author per day would not be worth it.
const USER_TTL_DAYS = 30;
const QUERIES = JSON.parse(fs.readFileSync(new URL("./x-queries.json", import.meta.url), "utf8"));

const token = process.env.X_BEARER_TOKEN?.trim();
if (!token) { console.log("X_BEARER_TOKEN not set; skipping X fetch."); process.exit(0); }
if (/\s/.test(token)) throw new Error("X_BEARER_TOKEN contains spaces or line breaks. Save only the Bearer Token (one line) in the repo secret.");

const BPATH = "data/x_budget.json";
const month = new Date().toISOString().slice(0, 7);
let budget = fs.existsSync(BPATH) ? JSON.parse(fs.readFileSync(BPATH, "utf8")) : {};
if (budget.month !== month) budget = { month, units: 0, posts: 0, users: 0, media: 0, cap: MONTHLY_CAP };
budget.units ??= budget.reads ?? 0; delete budget.reads;   // pre-units files counted posts only
// Pace evenly: a run may start only while today's spend is under cap / days in month (overshoot <= one run).
const today = new Date().toISOString().slice(0, 10);
if (budget.day !== today) { budget.day = today; budget.dayUnits = 0; }
const days = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate();
const dailyCap = Math.floor(MONTHLY_CAP / days);
const left = MONTHLY_CAP - budget.units;
// Size the run for the worst case (every post has media and a new author) so the last run of the month cannot overshoot the cap.
const n = Math.min(PER_RUN, Math.floor(left / (COST.post + COST.media + COST.user)));
if (n < 10) { console.log(`Monthly X budget reached (${budget.units}/${MONTHLY_CAP} units); skipping.`); process.exit(0); }
if (budget.dayUnits >= dailyCap) { console.log(`Daily X pace reached (${budget.dayUnits}/${dailyCap} units); skipping.`); process.exit(0); }
// Record spend as it happens, so a crash mid-run still leaves an honest budget on disk.
const spend = (kind, k) => { const u = k * COST[kind]; budget.units += u; budget.dayUnits += u; const key = { post: "posts", media: "media", user: "users" }[kind]; budget[key] = (budget[key] ?? 0) + k; };

const Q = QUERIES[(budget.next ?? 0) % QUERIES.length];
budget.next = ((budget.next ?? 0) + 1) % QUERIES.length;

async function search(query) {
  const params = new URLSearchParams({
    query, max_results: String(Math.max(10, n)), sort_order: "relevancy",
    "tweet.fields": "created_at,public_metrics,lang,author_id,attachments",
    // Media is expanded because "videos first" needs the type. Authors are not: an expansion is all-or-nothing per
    // request, so it would bill every author on every post. We look up only unseen authors below instead.
    expansions: "attachments.media_keys",
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
spend("post", posts.length);
spend("media", (j.includes?.media ?? []).length);

// Author profiles: look up only authors we haven't seen (or whose cached profile is stale).
const UPATH = "data/x_users.csv";
const UHEAD = ["id", "username", "name", "verified_type", "created_at", "followers", "following", "posts", "location", "url", "description", "fetched_at"];
const cache = new Map(readCSV(UPATH).rows.map((u) => [u.id, u]));
const stale = (u) => !u || Date.now() - Date.parse(u.fetched_at) > USER_TTL_DAYS * 864e5;
const need = [...new Set(posts.map((p) => p.author_id))].filter((id) => stale(cache.get(id)));
// One batched call (up to 100 ids) instead of one per author: fewer requests, same per-user price.
if (need.length) {
  const params = new URLSearchParams({ ids: need.join(","), "user.fields": "username,name,verified_type,created_at,public_metrics,location,url,description,entities" });
  const ur = await fetch(`https://api.x.com/2/users?${params}`, { headers: { authorization: `Bearer ${token}` } });
  const uj = await ur.json();
  // A failed lookup is not fatal: posts still save (username falls back to "i" in the URL) and the author is retried next run.
  if (!ur.ok) console.log(`WARNING: user lookup HTTP ${ur.status}: ${JSON.stringify(uj).slice(0, 200)}`);
  const got = uj.data ?? [];
  spend("user", got.length);
  const at = new Date().toISOString();
  for (const u of got) {
    const pm = u.public_metrics ?? {};
    // u.url is a t.co shortlink; the expanded URL is what a human needs to judge the account.
    const link = u.entities?.url?.urls?.[0]?.expanded_url ?? u.url ?? "";
    cache.set(u.id, { id: u.id, username: u.username, name: u.name, verified_type: u.verified_type ?? "", created_at: u.created_at ?? "",
      followers: pm.followers_count ?? "", following: pm.following_count ?? "", posts: pm.tweet_count ?? "",
      location: u.location ?? "", url: link, description: (u.description ?? "").replace(/\s+/g, " "), fetched_at: at });
  }
  writeCSV(UPATH, UHEAD, [...cache.values()].sort((a, b) => a.username.localeCompare(b.username)));
}
budget.updated = new Date().toISOString();
fs.writeFileSync(BPATH, JSON.stringify(budget, null, 2) + "\n");

// Posts are joined to authors by id, not handle, because handles can change.
const users = cache;
const media = new Map((j.includes?.media ?? []).map((m) => [m.media_key, m]));
const PATH = "data/x_posts.csv";
const HEAD = ["id", "created_at", "author_id", "username", "name", "text", "lang", "views", "likes", "reposts", "replies", "media_type", "preview", "url", "fetched_at", "query"];
const byId = new Map(readCSV(PATH).rows.map((r) => [r.id, r]));
const now = new Date().toISOString();
for (const p of posts) {
  const u = users.get(p.author_id) ?? {};
  const m = media.get(p.attachments?.media_keys?.[0]) ?? {};
  const pm = p.public_metrics ?? {};
  byId.set(p.id, {
    id: p.id, created_at: p.created_at, author_id: p.author_id ?? "", username: u.username ?? "", name: u.name ?? "",
    text: p.text.replace(/\s+/g, " "), lang: p.lang ?? "",
    views: pm.impression_count ?? "", likes: pm.like_count ?? "", reposts: (pm.retweet_count ?? 0) + (pm.quote_count ?? 0), replies: pm.reply_count ?? "",
    media_type: m.type ?? "", preview: m.preview_image_url ?? m.url ?? "",
    url: `https://x.com/${u.username ?? "i"}/status/${p.id}`, fetched_at: now, query: Q.id,
  });
}
const rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2000);
writeCSV(PATH, HEAD, rows);
console.log(`X ${Q.id} (${Q.label}): ${posts.length} posts, ${(j.includes?.media ?? []).length} media, ${need.length} new authors (month ${budget.units}/${MONTHLY_CAP} units, today ${budget.dayUnits}/${dailyCap}); file has ${rows.length}.`);
