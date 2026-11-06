// Fetches daily Strait of Hormuz transit counts from IMF PortWatch (ArcGIS FeatureServer)
// and writes data/transits_portwatch.csv. Node 20+, no dependencies.
// NOTE: field names below are from memory and have not been verified against the live API.
// The script fails loudly, listing the real fields, if they differ.
import fs from "node:fs";

const BASE = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const WANT = ["date", "n_tanker", "n_total", "capacity_tanker"];
const PAGE = 1000;

async function page(offset) {
  const q = new URLSearchParams({
    where: "portname='Strait of Hormuz'", outFields: "*", orderByFields: "date ASC",
    resultOffset: String(offset), resultRecordCount: String(PAGE), f: "json",
  });
  const res = await fetch(`${BASE}?${q}`);
  if (!res.ok) throw new Error(`PortWatch HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`PortWatch error: ${JSON.stringify(j.error)}`);
  return j;
}

const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const j = await page(offset);
  const feats = j.features ?? [];
  if (offset === 0) {
    if (!feats.length) throw new Error("PortWatch returned no rows for portname='Strait of Hormuz'");
    const have = Object.keys(feats[0].attributes);
    const missing = WANT.filter((f) => !have.includes(f));
    if (missing.length) throw new Error(`Missing fields ${missing.join(", ")}. Available: ${have.join(", ")}`);
  }
  rows.push(...feats.map((f) => f.attributes));
  if (!j.exceededTransferLimit && feats.length < PAGE) break;
}

const iso = (v) => new Date(typeof v === "number" ? v : Date.parse(v)).toISOString().slice(0, 10);
const out = ["date,n_tanker,n_total,capacity_tanker",
  ...rows.map((r) => [iso(r.date), r.n_tanker, r.n_total, r.capacity_tanker].join(","))];
fs.writeFileSync("data/transits_portwatch.csv", out.join("\n") + "\n");
console.log(`Wrote ${rows.length} days, ${iso(rows[0].date)} to ${iso(rows.at(-1).date)}`);
