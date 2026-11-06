// Daily Strait of Hormuz transit counts (IMF PortWatch) -> data/transits_portwatch.csv.
// Node 20+, no dependencies.
//
// 1) IMF PortWatch FeatureServer, layer 0, portid 'chokepoint6'. Since late Oct 2026 it fails
//    intermittently with 200 + {"error":{code:400}} (seen in our runs and in other projects),
//    so each page is retried with backoff.
// 2) Fallback: straits.live's daily mirror of the same PortWatch series (CSV, IMF attribution).
//    It has tanker and total counts but no capacity.
import fs from "node:fs";

const FS = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query";
const MIRROR = "https://straits.live/data/transits.csv";
const OUT = "data/transits_portwatch.csv";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One page of up to 1,000 daily rows. ArcGIS caps page size, so the caller walks offsets.
async function fsPage(offset) {
  const q = new URLSearchParams({
    where: "portid = 'chokepoint6'", outFields: "date,portname,n_tanker,n_total,capacity_tanker",
    resultOffset: String(offset), resultRecordCount: "1000", f: "json",
  });
  let last;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(`${FS}?${q}`);
      const j = await res.json();
      // ArcGIS reports many errors as HTTP 200 with an "error" object, so check both.
      if (res.ok && !j.error) return j;
      last = JSON.stringify(j.error ?? res.status);
    } catch (e) { last = e.message; }
    console.warn(`FeatureServer offset ${offset} attempt ${attempt} failed: ${last}`);
    await sleep(2000 * attempt);
  }
  throw new Error(`FeatureServer failed after retries: ${last}`);
}

async function viaFeatureServer() {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const j = await fsPage(offset);
    const feats = j.features ?? [];
    rows.push(...feats.map((f) => f.attributes));
    if (!j.exceededTransferLimit && feats.length < 1000) break;
  }
  if (!rows.length) throw new Error("FeatureServer returned no rows for chokepoint6");
  // Log the name so a silent change in what chokepoint6 refers to would show up in the run log.
  console.log(`PortWatch portname: ${rows[0].portname}`);
  return rows.map((r) => ({ date: toISO(r.date), n_tanker: r.n_tanker, n_total: r.n_total, capacity_tanker: Math.round(r.capacity_tanker) }));
}

async function viaMirror() {
  const text = await (await fetch(MIRROR)).text();
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const h = head.toLowerCase().split(",");
  // Find columns by name, not position: the mirror has changed its header before.
  const col = (...names) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const iDate = col("date"), iT = col("n_tanker", "tanker"), iN = col("n_total", "total");
  if (iDate < 0 || iT < 0 || iN < 0) throw new Error(`Mirror header unexpected: ${head}`);
  return lines.map((l) => l.split(",")).map((c) => ({ date: toISO(c[iDate]), n_tanker: +c[iT], n_total: +c[iN], capacity_tanker: "" }));
}

// PortWatch returns dates as epoch milliseconds; the mirror as text. Normalise both to YYYY-MM-DD (UTC).
function toISO(v) {
  if (typeof v === "number" || /^\d{10,}$/.test(String(v))) return new Date(Number(v)).toISOString().slice(0, 10);
  const s = String(v).trim().replace(/\//g, "-");
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  if (Number.isNaN(+d)) throw new Error(`Unparseable date "${v}"`);
  return d.toISOString().slice(0, 10);
}

let rows, via;
try { rows = await viaFeatureServer(); via = "IMF PortWatch FeatureServer"; }
catch (e) { console.warn(`${e.message}; using straits.live mirror`); rows = await viaMirror(); via = "straits.live mirror of IMF PortWatch"; }

// De-duplicate by date (last value wins) and record which source each run used, so the chart can say so.
const byDate = new Map(rows.map((r) => [r.date, r]));
const dates = [...byDate.keys()].sort();
const lines = ["date,n_tanker,n_total,capacity_tanker,via",
  ...dates.map((d) => { const r = byDate.get(d); return [d, r.n_tanker, r.n_total, r.capacity_tanker, via].join(","); })];
fs.writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`${via}: wrote ${dates.length} days, ${dates[0]} to ${dates.at(-1)}`);
