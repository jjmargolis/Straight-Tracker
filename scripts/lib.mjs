// Shared helpers for the fetch scripts. No dependencies.
import fs from "node:fs";

export function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.length > 1 || r[0]);
  const h = head.map((s) => s.replace(/^﻿/, "").trim());
  return { head: h, rows: body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))) };
}

const cell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function writeCSV(path, head, rows) {
  fs.writeFileSync(path, [head.join(","), ...rows.map((r) => head.map((k) => cell(r[k])).join(","))].join("\n") + "\n");
}
export const readCSV = (path) => (fs.existsSync(path) ? parseCSV(fs.readFileSync(path, "utf8")) : { head: [], rows: [] });
