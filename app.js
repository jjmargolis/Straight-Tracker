// Hormuz Tracker: static dashboard. Reads CSV/JSON from ./data, renders with Observable Plot.
/* global d3, Plot */

const WAR_START = new Date("2026-02-28T00:00:00Z");
const VIEWS = {
  strait: { label: "Strait", bbox: [55.3, 24.9, 57.7, 27.35] },
  region: { label: "Whole Gulf", bbox: [47.8, 22.6, 60.2, 30.3] },
};
// Label positions are approximate (from memory, cosmetic only).
const PLACES = [
  { name: "IRAN", lon: 57.3, lat: 27.6, big: true },
  { name: "OMAN", lon: 58.6, lat: 23.4, big: true },
  { name: "UAE", lon: 54.3, lat: 23.9, big: true },
  { name: "Bandar Abbas", lon: 56.27, lat: 27.18 },
  { name: "Khasab", lon: 56.25, lat: 26.18 },
  { name: "Fujairah", lon: 56.33, lat: 25.12 },
  { name: "Dubai", lon: 55.27, lat: 25.2 },
];

const OUTCOME = {
  sunk: "lost", total_loss: "lost",
  disabled: "damaged", damaged: "damaged",
};
const CLASSES = [
  { key: "lost", label: "Sunk or total loss", color: "var(--critical)" },
  { key: "damaged", label: "Damaged or disabled", color: "var(--serious)" },
  { key: "other", label: "Hit, outcome unknown", color: "var(--neutral)" },
];
const classOf = (d) => OUTCOME[d.outcome] ?? "other";
const colorOf = (k) => CLASSES.find((c) => c.key === k).color;

const state = { view: "strait", showClaimed: false, selected: null };
const fmtDate = d3.utcFormat("%-d %b %Y");
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function csv(path) {
  try { return await d3.csv(path, d3.autoType); } catch { return null; }
}

const [incidentsRaw, sources, flow, transits, land] = await Promise.all([
  csv("data/incidents.csv"),
  csv("data/incident_sources.csv"),
  csv("data/flow_eia.csv"),
  csv("data/transits_portwatch.csv"),
  d3.json("data/land.json"),
]);

const incidents = incidentsRaw.map((d) => ({
  ...d,
  date: d.date instanceof Date ? d.date : new Date(d.date),
  cls: classOf(d),
  located: Number.isFinite(d.lat) && Number.isFinite(d.lon),
  approx: d.position_quality !== "reported",
}));
const trailById = d3.group(sources ?? [], (s) => s.incident_id);

const visible = () => incidents.filter((d) => state.showClaimed || d.confidence !== "claimed");

/* ---------- KPIs ---------- */
function renderKpis() {
  const inc = visible().filter((d) => d.conflict === "iran_war_2026");
  const lost = inc.filter((d) => d.cls === "lost").length;
  const deaths = d3.sum(inc, (d) => d.deaths);
  const days = Math.floor((Date.now() - WAR_START) / 864e5);
  const pre = flow.find((f) => f.period === "4Q25");
  const last = flow[flow.length - 1];
  const pct = Math.round((last.mbd / pre.mbd - 1) * 100);
  const tiles = [
    { v: `${last.mbd}`, l: `mb/d oil flow, ${last.period}`, s: `${pct}% vs ${pre.mbd} in ${pre.period} · <a href="${esc(last.source_url)}">EIA</a>` },
    { v: inc.length, l: "ships hit since 28 Feb", s: "in this dataset; true count is higher" },
    { v: lost, l: "sunk or total loss", s: "in this dataset" },
    { v: deaths, l: "seafarer deaths recorded", s: "where a source gives a number" },
    { v: days, l: "days since war began", s: "28 Feb 2026" },
  ];
  el("kpis").innerHTML = tiles.map((t) => `<div class="kpi"><div class="v">${t.v}</div><div class="l">${t.l}</div><div class="s">${t.s}</div></div>`).join("");
}

/* ---------- Filters ---------- */
function renderFilters() {
  const views = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}" aria-pressed="${state.view === k}">${v.label}</button>`);
  const claimed = `<button data-claimed aria-pressed="${state.showClaimed}" title="Include unverified claims, e.g. social media">Unverified claims</button>`;
  el("filters").innerHTML = views.join("") + claimed;
  el("filters").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.view) state.view = b.dataset.view;
    if ("claimed" in b.dataset) state.showClaimed = !state.showClaimed;
    renderAll();
  };
}

/* ---------- Map ---------- */
function renderMap() {
  const [x0, y0, x1, y1] = VIEWS[state.view].bbox;
  const domain = { type: "Polygon", coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] };
  const pts = visible().filter((d) => d.located);
  const width = el("map").clientWidth || 800;
  const inView = (p) => p.lon >= x0 && p.lon <= x1 && p.lat >= y0 && p.lat <= y1;

  const plot = Plot.plot({
    width, height: Math.min(width * 0.85, 560),
    projection: { type: "mercator", domain, inset: 0 },
    style: { background: "var(--water)", fontFamily: "inherit" },
    marks: [
      Plot.geo(land, { fill: "var(--land)", stroke: "var(--coast)", strokeWidth: 0.75 }),
      Plot.text(PLACES.filter(inView).filter((p) => state.view === "strait" || p.big), {
        x: "lon", y: "lat", text: "name", fill: "var(--muted)",
        fontSize: (p) => (p.big ? 12 : 10), fontWeight: (p) => (p.big ? 600 : 400),
        letterSpacing: (p) => (p.big ? 2 : 0),
      }),
      // approximate / inferred positions: hollow ring
      Plot.dot(pts.filter((d) => d.approx), {
        x: "lon", y: "lat", r: 6, stroke: (d) => colorOf(d.cls), strokeWidth: 2.5, fill: "var(--surface)", fillOpacity: 0.6,
      }),
      // reported positions: solid with surface ring
      Plot.dot(pts.filter((d) => !d.approx), {
        x: "lon", y: "lat", r: 6, fill: (d) => colorOf(d.cls), stroke: "var(--surface)", strokeWidth: 2,
      }),
      Plot.dot(pts, { x: "lon", y: "lat", r: 11, stroke: (d) => (d === state.selected ? "var(--ink)" : "none"), strokeWidth: 1.5, fill: "none" }),
      Plot.tip(pts, Plot.pointer({
        x: "lon", y: "lat", maxRadius: 24,
        title: (d) => `${d.vessel_name}\n${fmtDate(d.date)} · ${d.vessel_type || "vessel"}\n${CLASSES.find((c) => c.key === d.cls).label}`,
      })),
    ],
  });
  plot.addEventListener("click", () => { if (plot.value) select(plot.value); });
  el("map").replaceChildren(plot);

  el("map-legend").innerHTML = CLASSES.map((c) => `<span><i class="dot" style="background:${c.color}"></i>${c.label}</span>`).join("")
    + `<span><i class="dot hollow" style="color:var(--muted)"></i>Approximate position</span>`;
  const unlocated = visible().length - pts.length;
  el("map-note").textContent = unlocated
    ? `${unlocated} incident${unlocated > 1 ? "s have" : " has"} no reliable position yet and appear only in the table.`
    : "";
}

/* ---------- Oil flow ---------- */
function renderFlow() {
  const data = flow.map((d) => ({ ...d, start: new Date(d.start), end: new Date(d.end) }));
  const pre = flow.find((f) => f.period === "4Q25").mbd;
  const plot = Plot.plot({
    width: el("flow").clientWidth || 600, height: 240, marginLeft: 36,
    x: { type: "utc", label: null },
    y: { domain: [0, 25], label: null, grid: true, ticks: 5 },
    style: { fontFamily: "inherit", color: "var(--ink-2)" },
    marks: [
      Plot.rectY(data, {
        x1: "start", x2: "end", y: "mbd", insetLeft: 1, insetRight: 1,
        fill: "var(--accent)", rx: 2,
      }),
      Plot.ruleY([pre], { stroke: "var(--muted)", strokeDasharray: "3,3" }),
      Plot.ruleX([WAR_START], { stroke: "var(--critical)", strokeWidth: 1.5 }),
      Plot.text([WAR_START], { x: (d) => d, y: 24, text: () => "War begins", textAnchor: "end", dx: -4, fill: "var(--critical)", fontSize: 11 }),
      Plot.text(data.filter((d) => d.kind === "quarter"), { x: (d) => new Date((+d.start + +d.end) / 2), y: "mbd", text: (d) => `${d.mbd}`, dy: -8, fill: "var(--ink)", fontSize: 11 }),
      Plot.ruleY([0]),
      Plot.tip(data, Plot.pointerX({ x: (d) => new Date((+d.start + +d.end) / 2), y: "mbd", title: (d) => `${d.period}: ${d.mbd} mb/d${d.notes ? "\n" + d.notes : ""}` })),
    ],
  });
  el("flow").replaceChildren(plot);
  el("flow-note").innerHTML = `Annual and half-year bars to 1H25, then quarters. Dashed line: ${pre} mb/d pre-war (4Q25).
    No free source publishes 3Q26 yet. <a href="https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints/">EIA chokepoints</a> ·
    <a href="https://www.eia.gov/outlooks/steo/">EIA STEO</a>`;
}

/* ---------- PortWatch transits ---------- */
function renderTransits() {
  if (!transits?.length) {
    el("transits").innerHTML = `<p class="muted">Waiting for the first daily fetch from IMF PortWatch.</p>`;
    el("transits-note").textContent = "";
    return;
  }
  const data = transits.map((d) => ({ ...d, date: new Date(d.date) }));
  const plot = Plot.plot({
    width: el("transits").clientWidth || 600, height: 220, marginLeft: 36,
    x: { type: "utc", label: null }, y: { label: null, grid: true, ticks: 5 },
    style: { fontFamily: "inherit", color: "var(--ink-2)" },
    marks: [
      Plot.ruleX([WAR_START], { stroke: "var(--critical)", strokeDasharray: "3,3" }),
      Plot.lineY(data, Plot.windowY({ k: 7 }, { x: "date", y: "n_tanker", stroke: "var(--accent)", strokeWidth: 2 })),
      Plot.ruleY([0]),
      Plot.tip(data, Plot.pointerX({ x: "date", y: "n_tanker", title: (d) => `${fmtDate(d.date)}: ${d.n_tanker} tankers` })),
    ],
  });
  el("transits").replaceChildren(plot);
  const last = data[data.length - 1];
  el("transits-note").innerHTML = `7-day average. Latest: ${fmtDate(last.date)}. AIS misses ships with transponders off, so this undercounts.
    <a href="https://portwatch.imf.org/">IMF PortWatch</a>`;
}

/* ---------- Monthly ---------- */
function renderMonthly() {
  const inc = visible().filter((d) => d.conflict === "iran_war_2026");
  const plot = Plot.plot({
    width: el("monthly").clientWidth || 600, height: 200, marginLeft: 30,
    x: { type: "utc", label: null, domain: [WAR_START, d3.utcMonth.offset(d3.utcMonth.floor(new Date()), 1)] },
    y: { label: null, grid: true, ticks: 4 },
    color: { domain: CLASSES.map((c) => c.key), range: CLASSES.map((c) => c.color) },
    style: { fontFamily: "inherit", color: "var(--ink-2)" },
    marks: [
      Plot.rectY(inc, Plot.binX({ y: "count" }, { x: "date", interval: d3.utcMonth, fill: "cls", order: CLASSES.map((c) => c.key), insetLeft: 1, insetRight: 1, stroke: "var(--surface)", strokeWidth: 1, tip: true })),
      Plot.ruleY([0]),
    ],
  });
  el("monthly").replaceChildren(plot);
}

/* ---------- Table ---------- */
function renderTable() {
  const rows = [...visible()].sort((a, b) => b.date - a.date);
  el("table-count").textContent = `${rows.length} records`;
  el("table").innerHTML = `<thead><tr><th>Date</th><th>Vessel</th><th>Type</th><th>Outcome</th><th>Where</th><th>Confidence</th></tr></thead><tbody>${
    rows.map((d, i) => `<tr data-i="${incidents.indexOf(d)}" class="${d === state.selected ? "sel" : ""}">
      <td>${fmtDate(d.date)}</td><td>${esc(d.vessel_name)}</td><td>${esc(d.vessel_type)}</td>
      <td><i class="dot" style="background:${colorOf(d.cls)}"></i> ${esc(d.outcome)}</td>
      <td>${esc(d.location_text)}</td><td>${esc(d.confidence)}</td></tr>`).join("")
  }</tbody>`;
  el("table").onclick = (e) => {
    const tr = e.target.closest("tr[data-i]"); if (tr) select(incidents[+tr.dataset.i]);
  };
}

/* ---------- Detail + source trail ---------- */
function select(d) {
  state.selected = d;
  const trail = trailById.get(d.id) ?? [];
  const f = (k, v) => (v || v === 0 ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
  el("detail").innerHTML = `<h2>Details</h2>
    <h3>${esc(d.vessel_name)}</h3>
    <span class="badge"><i class="dot" style="background:${colorOf(d.cls)}"></i>${esc(d.outcome)}</span>
    <span class="badge">${esc(d.confidence)}</span>
    <dl>
      ${f("Date", fmtDate(d.date))}${f("Type", d.vessel_type)}${f("Flag", d.flag)}${f("IMO", d.imo)}
      ${f("Event", d.event_type)}${f("Attacker", d.attacker)}${f("Position", d.location_text)}
      ${f("Precision", d.position_quality)}${f("Deaths", d.deaths)}${f("Casualties", d.casualties)}
    </dl>
    ${d.notes ? `<p class="note">${esc(d.notes)}</p>` : ""}
    <h2 style="margin-top:12px">Sources (${trail.length})</h2>
    <ul class="trail">${trail.map((s) => `<li><strong>${esc(s.source_name)}</strong> <span class="muted">· ${esc(s.source_type)}${s.published ? " · " + esc(s.published instanceof Date ? fmtDate(s.published) : s.published) : ""}</span><br>
      ${esc(s.claim)} ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">link</a>` : ""}</li>`).join("") || "<li class='muted'>No sources recorded.</li>"}</ul>`;
  renderMap(); renderTable();
}

function renderAll() {
  renderFilters(); renderKpis(); renderMap(); renderMonthly(); renderTable();
}

const updated = d3.max(incidents, (d) => d.date);
el("asof").textContent = `Latest incident: ${fmtDate(updated)}`;
renderAll(); renderFlow(); renderTransits();

let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { renderMap(); renderFlow(); renderTransits(); renderMonthly(); }, 150); });
