// Fetches daily Strait of Hormuz transit counts from IMF PortWatch and writes
// data/transits_portwatch.csv. Node 20+, no dependencies.
//
// Primary: the ArcGIS Hub CSV export of the Daily_Chokepoints_Data item (served from cache).
// Fallback: the FeatureServer query API, which has returned errors since late Oct 2026
// (our first run got "400 Invalid URL"; see also koala73/worldmonitor PR #10001, 2026-11-01).
import fs from "node:fs";

const ITEM = "3da2b9ca97684916b75c4013f95d18ab"; // Daily_Chokepoints_Data
const CSV_URL = `https://hub.arcgis.com/api/download/v1/items/${ITEM}/csv?layers=0`;
const FS_URL = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const WANT = ["date", "n_tanker", "n_total", "capacity_tanker"];
const isHormuz = (r) => /hormuz/i.test(r.portname ?? "");

function parseCSV(text) {
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
  const [head, ...body] = rows.filter((r) => r.length > 1);
  const h = head.map((s) => s.replace(/^﻿/, "").trim().toLowerCase());
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

async function viaCsv() {
  const res = await fetch(CSV_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`CSV export HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes(",")) throw new Error(`CSV export returned non-CSV: ${text.slice(0, 200)}`);
  return parseCSV(text).filter(isHormuz);
}

async function viaFeatureServer() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({
      where: "portname LIKE '%Hormuz%'", outFields: [...WANT, "portname"].join(","),
      resultOffset: String(offset), resultRecordCount: "1000", f: "json",
    });
    const res = await fetch(`${FS_URL}?${q}`);
    if (!res.ok) throw new Error(`FeatureServer HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(`FeatureServer error: ${JSON.stringify(j.error)}`);
    const feats = j.features ?? [];
    out.push(...feats.map((f) => f.attributes));
    if (!j.exceededTransferLimit && feats.length < 1000) break;
  }
  return out;
}

export function toISO(v) {
  if (typeof v === "number" || /^\d{10,}$/.test(String(v))) return new Date(Number(v)).toISOString().slice(0, 10);
  const s = String(v).trim().replace(/\//g, "-");
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  if (Number.isNaN(+d)) throw new Error(`Unparseable date "${v}"`);
  return d.toISOString().slice(0, 10);
}

let rows, via;
try { rows = await viaCsv(); via = "Hub CSV export"; }
catch (e) { console.warn(`CSV export failed (${e.message}); trying FeatureServer`); rows = await viaFeatureServer(); via = "FeatureServer"; }

if (!rows.length) throw new Error(`${via}: no Strait of Hormuz rows`);
const missing = WANT.filter((k) => !(k in rows[0]));
if (missing.length) throw new Error(`${via}: missing fields ${missing.join(", ")}. Available: ${Object.keys(rows[0]).join(", ")}`);

const byDate = new Map();
for (const r of rows) byDate.set(toISO(r.date), r);
const dates = [...byDate.keys()].sort();
const out = ["date,n_tanker,n_total,capacity_tanker",
  ...dates.map((d) => { const r = byDate.get(d); return [d, +r.n_tanker, +r.n_total, Math.round(+r.capacity_tanker)].join(","); })];
fs.writeFileSync("data/transits_portwatch.csv", out.join("\n") + "\n");
console.log(`${via}: wrote ${dates.length} days, ${dates[0]} to ${dates.at(-1)} (portname: ${rows[0].portname})`);
