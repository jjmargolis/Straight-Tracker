// Validates data/*.csv: headers, enums, dates, coordinates in region, source trail integrity.
// Usage: node scripts/validate.mjs   (exits 1 on any error)
import fs from "node:fs";

function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return { head, rows: body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))) };
}

const errors = [];
const err = (file, i, msg) => errors.push(`${file}:${i + 2}: ${msg}`);
const enumCheck = (file, i, row, key, allowed, optional = false) => {
  if (optional && row[key] === "") return;
  if (!allowed.includes(row[key])) err(file, i, `${key}="${row[key]}" not in [${allowed.join(", ")}]`);
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const INC_HEAD = "id,date,vessel_name,imo,vessel_type,flag,lat,lon,position_quality,location_text,event_type,outcome,deaths,casualties,attacker,conflict,confidence,source_primary,source_url,notes,target";
const SRC_HEAD = "incident_id,source_name,source_type,url,published,claim,lat,lon,notes";
// Region box: Persian Gulf, Strait, Gulf of Oman, northern Arabian Sea.
const BOX = { lon: [46, 66], lat: [12, 31] };

const inc = parseCSV(fs.readFileSync("data/incidents.csv", "utf8"));
if (inc.head.join(",") !== INC_HEAD) err("data/incidents.csv", -1, `header mismatch.\n  want: ${INC_HEAD}\n  got:  ${inc.head.join(",")}`);
const ids = new Set();
inc.rows.forEach((r, i) => {
  const F = "data/incidents.csv";
  if (!r.id) err(F, i, "missing id");
  if (ids.has(r.id)) err(F, i, `duplicate id ${r.id}`); ids.add(r.id);
  if (!isDate(r.date)) err(F, i, `bad date "${r.date}"`);
  if (!r.vessel_name) err(F, i, "missing vessel_name (use Withheld/Unknown)");
  enumCheck(F, i, r, "position_quality", ["reported", "approximate", "inferred", "unknown"]);
  enumCheck(F, i, r, "event_type", ["attack", "near_miss", "seizure", "mine", "suspicious", "advisory"]);
  enumCheck(F, i, r, "outcome", ["sunk", "total_loss", "disabled", "damaged", "continued", "unknown"]);
  enumCheck(F, i, r, "attacker", ["iran", "us", "israel", "unknown"]);
  enumCheck(F, i, r, "conflict", ["tanker_war_1984_88", "2019_2021", "iran_war_2026"]);
  enumCheck(F, i, r, "confidence", ["confirmed", "reported", "claimed"]);
  // Civil infrastructure is in scope (Jacob, 2026-11-06). For non-vessel targets, vessel_name holds the facility name.
  enumCheck(F, i, r, "target", ["vessel", "port", "oil_terminal", "refinery", "desalination", "power", "cable", "airport", "other_infrastructure"]);
  const hasPos = r.lat !== "" || r.lon !== "";
  if (hasPos) {
    const lat = +r.lat, lon = +r.lon;
    if (!(lat >= BOX.lat[0] && lat <= BOX.lat[1] && lon >= BOX.lon[0] && lon <= BOX.lon[1])) err(F, i, `lat/lon ${r.lat},${r.lon} outside region box`);
    if (r.position_quality === "unknown") err(F, i, "has lat/lon but position_quality=unknown");
  } else if (r.position_quality !== "unknown") err(F, i, `no lat/lon but position_quality=${r.position_quality}`);
  if (r.deaths !== "" && !/^\d+$/.test(r.deaths)) err(F, i, `deaths must be an integer or blank, got "${r.deaths}"`);
  if (r.imo && !/^\d{7}$/.test(r.imo)) err(F, i, `IMO must be 7 digits, got "${r.imo}"`);
});

const src = parseCSV(fs.readFileSync("data/incident_sources.csv", "utf8"));
if (src.head.join(",") !== SRC_HEAD) err("data/incident_sources.csv", -1, `header mismatch.\n  want: ${SRC_HEAD}\n  got:  ${src.head.join(",")}`);
const withSource = new Set();
src.rows.forEach((r, i) => {
  const F = "data/incident_sources.csv";
  if (!ids.has(r.incident_id)) err(F, i, `incident_id "${r.incident_id}" not in incidents.csv`);
  withSource.add(r.incident_id);
  enumCheck(F, i, r, "source_type", ["official", "security_firm", "trade_press", "news", "osint", "ais", "belligerent"]);
  if (r.url && !/^https?:\/\//.test(r.url)) err(F, i, `url must be http(s): "${r.url}"`);
  if (r.published && !isDate(r.published)) err(F, i, `bad published date "${r.published}"`);
});
for (const id of ids) if (!withSource.has(id)) errors.push(`data/incidents.csv: ${id} has no row in incident_sources.csv`);

if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} error(s)`); process.exit(1); }
console.log(`OK: ${inc.rows.length} incidents, ${src.rows.length} sources`);
