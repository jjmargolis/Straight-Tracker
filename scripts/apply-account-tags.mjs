// Applies Jacob's account tags from an issue body to data/account_overrides.csv (upsert by handle).
// The app's "Send to repo" button opens a prefilled issue; .github/workflows/account-tags.yml runs this
// only for issues opened by the repo owner. Body format (anything outside the fenced block is ignored):
//   ```csv
//   handle,type,lean,reliability,note
//   ...
//   ```
// Usage: ISSUE_BODY=... node scripts/apply-account-tags.mjs   (prints the number applied; exits 1 on bad input)
import fs from "node:fs";
import { parseCSV, readCSV, writeCSV } from "./lib.mjs";

const VOCAB = JSON.parse(fs.readFileSync("data/account_vocab.json", "utf8"));
// Only the fenced block is parsed, so Jacob can type anything around it without breaking the import.
const block = (process.env.ISSUE_BODY ?? "").replace(/\r/g, "").match(/```csv\n([\s\S]*?)```/)?.[1];
if (!block) { console.error("No ```csv block in the issue body."); process.exit(1); }
const { head, rows } = parseCSV(block);
if (head.join(",") !== "handle,type,lean,reliability,note") { console.error(`Bad header: ${head.join(",")}`); process.exit(1); }

const PATH = "data/account_overrides.csv";
const HEAD = ["handle", "type", "lean", "reliability", "note", "at"];
const byHandle = new Map(readCSV(PATH).rows.map((r) => [r.handle.toLowerCase(), r]));
const at = new Date().toISOString().slice(0, 10);
const bad = [];
for (const r of rows) {
  // X handles are 1-15 word characters; anything else is a typo or an injection attempt.
  if (!/^\w{1,15}$/.test(r.handle)) { bad.push(`bad handle "${r.handle}"`); continue; }
  for (const k of ["type", "lean", "reliability"]) if (r[k] && !(r[k] in VOCAB[k])) bad.push(`${r.handle}: ${k}="${r[k]}" not allowed`);
  // A row with no type, lean or reliability clears Jacob's override (back to Claude's tag).
  if (!r.type && !r.lean && !r.reliability) byHandle.delete(r.handle.toLowerCase());
  else byHandle.set(r.handle.toLowerCase(), { handle: r.handle, type: r.type, lean: r.lean, reliability: r.reliability, note: r.note.slice(0, 300), at });
}
// All-or-nothing: one bad row rejects the whole issue, so a half-applied batch never lands.
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
writeCSV(PATH, HEAD, [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle, "en", { sensitivity: "base" })));
console.log(rows.length);
