// Public Telegram channels via their web preview (t.me/s/<channel>): free, no account, no key.
// Keeps only posts that pass match.mjs, with view count and video/photo preview, for the monitor wall.
// The site shows each post with Telegram's official embed (telegram-widget.js), so video plays inline.
// Writes data/tg_posts.csv, merged by post id (views refresh while a post stays on the fetched pages).
import fs from "node:fs";
import { readCSV, writeCSV } from "./lib.mjs";
import { relevant } from "./match.mjs";

const { telegram } = JSON.parse(fs.readFileSync(new URL("./free-feeds.json", import.meta.url), "utf8"));
const PATH = "data/tg_posts.csv", KEEP_DAYS = 30;
const HEAD = ["id", "channel", "name", "kind", "lang", "created_at", "text", "views", "media_type", "duration", "preview", "url", "fetched_at"];
const UA = "Mozilla/5.0 (compatible; straight-tracker/1.0; +https://github.com/jjmargolis/straight-tracker)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rlm: "", lrm: "" };   // rlm/lrm: invisible direction marks common in Persian posts
const decode = (s) => s.replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ""), e[1]?.toLowerCase() === "x" ? 16 : 10)) : ENT[e] ?? m);
const strip = (s) => decode(s.replace(/<br\s*\/?>/g, " ").replace(/<i class="emoji"[^>]*><b>([^<]*)<\/b><\/i>/g, "$1").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const num = (s) => { const m = String(s ?? "").trim().match(/^([\d.]+)\s*([KM]?)$/i); return m ? Math.round(+m[1] * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] ?? 1)) : ""; };
const bg = (s) => (s?.match(/background-image:url\('([^']+)'\)/) ?? [])[1] ?? "";

function parse(html) {
  return html.split('class="tgme_widget_message_wrap').slice(1).map((m) => {
    const post = (m.match(/data-post="([^"]+)"/) ?? [])[1];
    if (!post) return null;
    const text = strip((m.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/) ?? [])[1] ?? "");
    const video = /tgme_widget_message_video_player|tgme_widget_message_roundvideo/.test(m);
    const vthumb = bg((m.match(/tgme_widget_message_video_thumb"[^>]*style="[^"]*"/) ?? [])[0]);
    const photo = bg((m.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*"/) ?? [])[0]);
    return {
      id: post, text,
      name: strip((m.match(/tgme_widget_message_owner_name"[^>]*>([\s\S]*?)<\/a>/) ?? [])[1] ?? ""),
      created_at: (m.match(/<time datetime="([^"]+)"/) ?? [])[1] ?? "",
      views: num((m.match(/tgme_widget_message_views">([^<]+)/) ?? [])[1]),
      media_type: video ? "video" : photo ? "photo" : "",
      duration: (m.match(/message_video_duration[^>]*>([^<]+)/) ?? [])[1] ?? "",
      preview: vthumb || photo,
    };
  }).filter(Boolean);
}

const byId = new Map(readCSV(PATH).rows.map((r) => [r.id, r]));
const now = new Date().toISOString();
let seen = 0, kept = 0, failed = [];
for (const ch of telegram) {
  let before = "";
  for (let p = 0; p < (ch.pages ?? 1); p++) {
    const res = await fetch(`https://t.me/s/${ch.handle}${before ? `?before=${before}` : ""}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) }).catch((e) => ({ ok: false, status: e.cause?.code ?? e.message }));
    if (!res.ok) { failed.push(`${ch.handle} ${res.status}`); break; }
    const posts = parse(await res.text());
    if (!posts.length) { if (p === 0) failed.push(`${ch.handle} no posts (preview off or renamed?)`); break; }
    seen += posts.length;
    for (const x of posts) {
      if (!relevant(x.text, ch.region)) continue;
      const old = byId.get(x.id);
      byId.set(x.id, { ...old, ...x, channel: x.id.split("/")[0], kind: ch.kind, lang: ch.lang, url: `https://t.me/${x.id}`, fetched_at: now, preview: x.preview || old?.preview || "" });
      if (!old) kept++;
    }
    before = posts.map((x) => +x.id.split("/")[1]).reduce((a, b) => Math.min(a, b));
    await sleep(1200);
  }
}
// Re-check stored rows too, so a tightened filter in match.mjs also clears out old false matches.
const regionOf = new Map(telegram.map((c) => [c.handle.toLowerCase(), !!c.region]));
const cutoff = Date.now() - KEEP_DAYS * 864e5;
const rows = [...byId.values()].filter((r) => Date.parse(r.created_at) >= cutoff && relevant(r.text, regionOf.get(String(r.channel).toLowerCase()))).sort((a, b) => b.created_at.localeCompare(a.created_at));
writeCSV(PATH, HEAD, rows);
console.log(`Telegram: ${telegram.length} channels, ${seen} posts scanned, ${kept} new matches, ${rows.length} kept (${rows.filter((r) => r.media_type === "video").length} videos).`);
if (failed.length) console.warn(`Telegram problems: ${failed.join("; ")}`);
if (failed.length === telegram.length) process.exit(1);
