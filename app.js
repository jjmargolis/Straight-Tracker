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

const state = { xWindow: 7, terms: "", videoOnly: false, who: "all", view: "strait", showClaimed: false, showNaval: false, selected: null };
const SAVED = "hormuz-monitor";
try { const { xWindow, terms, videoOnly, who } = JSON.parse(localStorage.getItem(SAVED)) ?? {}; Object.assign(state, { xWindow: xWindow ?? 7, terms: terms ?? "", videoOnly: !!videoOnly, who: who ?? "all" }); } catch {}
const save = () => { try { localStorage.setItem(SAVED, JSON.stringify({ xWindow: state.xWindow, terms: state.terms, videoOnly: state.videoOnly, who: state.who })); } catch {} };
const fmtDate = d3.utcFormat("%-d %b %Y");
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Data changes every few hours; a 10-minute cache-buster keeps browsers from showing stale files.
const BUST = Math.floor(Date.now() / 6e5);
async function csv(path) {
  const url = path + (path.includes("?") ? "&" : "?") + "b=" + BUST;
  // Keep X ids as text: they exceed 2^53 and would be rounded as numbers. Same for handles like "1500tasvir".
  const TEXT = ["id", "author_id", "user_id", "handle", "username"];
  try { return await d3.csv(url, (d) => { const keep = TEXT.map((k) => d[k]); d3.autoType(d); TEXT.forEach((k, i) => { if (keep[i] !== undefined) d[k] = keep[i]; }); return d; }); } catch { return null; }
}

let [incidentsRaw, sources, flow, transits, land, xposts, articles, coverage, media, accountsRaw, overridesRaw, xusers, vocab, budget] = await Promise.all([
  csv("data/incidents.csv"),
  csv("data/incident_sources.csv"),
  csv("data/flow_eia.csv"),
  csv("data/transits_portwatch.csv"),
  d3.json("data/land.json"),
  csv("data/x_posts.csv"),
  csv("data/gdelt_articles.csv"),
  csv("data/coverage_gdelt.csv"),
  csv("data/media.csv"),
  csv("data/accounts.csv"),
  csv("data/account_overrides.csv"),
  csv("data/x_users.csv"),
  d3.json("data/account_vocab.json").catch(() => null),
  d3.json(`data/x_budget.json?b=${BUST}`).catch(() => null),
]);

const incidents = incidentsRaw.map((d) => ({
  ...d,
  vessel_type: String(d.vessel_type ?? "").replaceAll("_", " "),
  date: d.date instanceof Date ? d.date : new Date(d.date),
  cls: classOf(d),
  located: Number.isFinite(d.lat) && Number.isFinite(d.lon),
  approx: d.position_quality !== "reported",
  infra: !!d.target && d.target !== "vessel",
}));
const trailById = d3.group(sources ?? [], (s) => s.incident_id);

const visible = () => incidents.filter((d) => (state.showClaimed || d.confidence !== "claimed") && (state.showNaval || d.vessel_type !== "naval"));

/* ---------- KPIs ---------- */
function renderKpis() {
  const all = visible().filter((d) => d.conflict === "iran_war_2026");
  const inc = all.filter((d) => !d.infra);
  const infra = all.filter((d) => d.infra);
  const lost = inc.filter((d) => d.cls === "lost").length;
  const deaths = d3.sum(inc, (d) => d.deaths);
  const days = Math.floor((Date.now() - WAR_START) / 864e5);
  const pre = flow.find((f) => f.period === "4Q25");
  const last = flow[flow.length - 1];
  const pct = Math.round((last.mbd / pre.mbd - 1) * 100);
  const tiles = [
    { v: `${last.mbd}`, l: `mb/d oil flow, ${last.period}`, s: `${pct}% vs ${pre.mbd} in ${pre.period} · <a href="${esc(last.source_url)}">EIA</a>` },
    { v: inc.filter((d) => d.event_type === "attack").length, l: "attacks on ships since 28 Feb", s: `plus ${inc.filter((d) => d.event_type !== "attack").length} seizures, mines, near misses; true count is higher` },
    { v: lost, l: "sunk or total loss", s: "in this dataset" },
    ...(infra.length ? [{ v: infra.length, l: "strikes on civil infrastructure", s: "ports, terminals, power, water, cables" }] : []),
    { v: deaths, l: "seafarer deaths recorded", s: "where a source gives a number" },
    { v: days, l: "days since war began", s: "28 Feb 2026" },
  ];
  el("kpis").innerHTML = tiles.map((t) => `<div class="kpi"><div class="v">${t.v}</div><div class="l">${t.l}</div><div class="s">${t.s}</div></div>`).join("");
}

/* ---------- Filters ---------- */
function renderFilters() {
  const views = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}" aria-pressed="${state.view === k}">${v.label}</button>`);
  const naval = `<button data-naval aria-pressed="${state.showNaval}" title="Include Iranian naval vessels">Naval</button>`;
  const claimed = `<button data-claimed aria-pressed="${state.showClaimed}" title="Include unverified claims, e.g. social media">Unverified claims</button>`;
  el("filters").innerHTML = views.join("") + naval + claimed;
  el("filters").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.view) state.view = b.dataset.view;
    if ("claimed" in b.dataset) { state.showClaimed = !state.showClaimed; save(); }
    if ("naval" in b.dataset) state.showNaval = !state.showNaval;
    renderAll(); renderSetup();
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
      // approximate / inferred positions: hollow ring (square = civil infrastructure)
      Plot.dot(pts.filter((d) => d.approx), {
        x: "lon", y: "lat", r: 6, symbol: (d) => (d.infra ? "square" : "circle"), stroke: (d) => colorOf(d.cls), strokeWidth: 2.5, fill: "var(--surface)", fillOpacity: 0.6,
      }),
      // reported positions: solid with surface ring
      Plot.dot(pts.filter((d) => !d.approx), {
        x: "lon", y: "lat", r: 6, symbol: (d) => (d.infra ? "square" : "circle"), fill: (d) => colorOf(d.cls), stroke: "var(--surface)", strokeWidth: 2,
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
    + `<span><i class="dot hollow" style="color:var(--muted)"></i>Approximate position</span>`
    + (pts.some((d) => d.infra) ? `<span><i class="dot" style="border-radius:1px;background:var(--muted)"></i>Civil infrastructure</span>` : "");
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
  const data = transits.map((d) => ({ ...d, date: new Date(d.date) })).filter((d) => d.date >= new Date("2025-01-01"));
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
  el("table").innerHTML = `<thead><tr><th>Date</th><th>Vessel or site</th><th>Type</th><th>Outcome</th><th>Where</th><th>Confidence</th></tr></thead><tbody>${
    rows.map((d, i) => `<tr data-i="${incidents.indexOf(d)}" class="${d === state.selected ? "sel" : ""}">
      <td>${fmtDate(d.date)}</td><td>${esc(d.vessel_name)}</td><td>${esc(d.infra ? d.target.replaceAll("_", " ") : d.vessel_type)}</td>
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
      ${f("Date", fmtDate(d.date))}${f("Target", d.infra ? d.target.replaceAll("_", " ") : "")}${f("Type", d.vessel_type)}${f("Flag", d.flag)}${f("IMO", d.imo)}
      ${f("Event", d.event_type)}${f("Attacker", d.attacker)}${f("Position", d.location_text)}
      ${f("Precision", d.position_quality)}${f("Deaths", d.deaths)}${f("Casualties", d.casualties)}
    </dl>
    ${d.notes ? `<p class="note">${esc(d.notes)}</p>` : ""}
    <h2 style="margin-top:12px">Sources (${trail.length})</h2>
    <ul class="trail">${trail.map((s) => `<li><strong>${esc(s.source_name)}</strong> <span class="muted">· ${esc(s.source_type)}${s.published ? " · " + esc(s.published instanceof Date ? fmtDate(s.published) : s.published) : ""}</span><br>
      ${esc(s.claim)} ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">link</a>` : ""}</li>`).join("") || "<li class='muted'>No sources recorded.</li>"}</ul>`;
  renderMap(); renderTable();
}


/* ---------- Media: X ---------- */
const fmtN = d3.format(".2~s");
const ago = (d) => { const h = (Date.now() - d) / 36e5; return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`; };
const score = (p) => (Number.isFinite(p.views) && p.views > 0 ? p.views : (p.likes || 0) * 50 + (p.reposts || 0) * 100);

function renderX() {
  el("x-filters").innerHTML = [1, 7, 30].map((d) => `<button data-days="${d}" aria-pressed="${state.xWindow === d}">${d === 1 ? "24h" : d + "d"}</button>`).join("");
  el("x-filters").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.xWindow = +b.dataset.days; save(); renderX(); renderSetup(); } };
  if (!xposts?.length) {
    el("xfeed").innerHTML = `<p class="empty">The X feed starts after the first daily fetch once the API token is added to the repo.</p>`;
    el("x-note").textContent = "";
    return;
  }
  const since = Date.now() - state.xWindow * 864e5;
  const posts = xposts.map((p) => ({ ...p, created: new Date(p.created_at) }))
    .filter((p) => p.created >= since).sort((a, b) => score(b) - score(a)).slice(0, 12);
  el("xfeed").innerHTML = posts.length ? posts.map((p) => `<a class="post" href="${esc(p.url)}" target="_blank" rel="noopener">
      <div><div class="who"><b>${esc(p.name)}</b> @${esc(p.username)} · ${ago(p.created)} ${chip(p.username)}</div>
      <div class="txt">${esc(p.text)}</div>
      <div class="stats">${Number.isFinite(p.views) ? `<span><b>${fmtN(p.views)}</b> views</span>` : ""}<span><b>${fmtN(p.likes || 0)}</b> likes</span><span><b>${fmtN(p.reposts || 0)}</b> reposts</span>${p.media_type ? `<span>${esc(p.media_type)}</span>` : ""}</div></div>
      ${p.preview ? `<img src="${esc(p.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</a>`).join("")
    : `<p class="empty">No posts in this window.</p>`;
  const last = d3.max(xposts, (p) => new Date(p.fetched_at));
  el("x-note").innerHTML = `Ranked by views (likes and reposts when views are hidden). Counts as of ${fmtDate(last)}. <strong>Unverified:</strong> footage is often recycled from older events.`;
}

/* ---------- Media: news (GDELT) ---------- */
function renderNews() {
  if (!articles?.length) { el("news").innerHTML = `<p class="empty">Waiting for the first GDELT fetch.</p>`; return; }
  el("news").innerHTML = articles.slice(0, 40).map((a) => `<a href="${esc(a.url)}" target="_blank" rel="noopener">
    <div class="t">${esc(a.title)}</div><div class="d">${esc(a.domain)} · ${ago(new Date(a.seendate))} ago${a.language && a.language !== "English" ? " · " + esc(a.language) : ""}</div></a>`).join("");
}

/* ---------- Media: curated ---------- */
const VERIF = { unreviewed: "Unreviewed", matches_incident: "Matches an incident", geolocated: "Geolocated", recycled: "Recycled footage", fabricated: "Fabricated" };
function renderCurated() {
  if (!media?.length) { el("curated-card").hidden = true; return; }
  el("curated-card").hidden = false;
  el("curated").innerHTML = [...media].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).map((m) => `<a class="post" href="${esc(m.url)}" target="_blank" rel="noopener"><div>
    <div class="who"><b>${esc(m.author)}</b> · ${esc(m.platform)} · ${esc(m.kind)}</div><div class="txt">${esc(m.title)}</div>
    <div class="stats"><span class="badge">${esc(VERIF[m.verification] ?? m.verification)}</span>${m.incident_id ? `<span>incident ${esc(m.incident_id)}</span>` : ""}</div></div></a>`).join("");
}

/* ---------- Coverage (GDELT volume) ---------- */
function renderCoverage() {
  if (!coverage?.length) { el("coverage").innerHTML = `<p class="empty">Waiting for the first GDELT fetch.</p>`; el("coverage-note").textContent = ""; return; }
  const data = coverage.map((d) => ({ ...d, date: new Date(d.date) })).filter((d) => d.date >= WAR_START);
  const hits = incidents.filter((d) => d.event_type === "attack" && d.vessel_type !== "naval");
  const plot = Plot.plot({
    width: el("coverage").clientWidth || 900, height: 220, marginLeft: 40,
    x: { type: "utc", label: null }, y: { label: null, grid: true, ticks: 4 },
    style: { fontFamily: "inherit", color: "var(--ink-2)" },
    marks: [
      Plot.areaY(data, { x: "date", y: "articles", fill: "var(--accent)", fillOpacity: 0.15, curve: "step" }),
      Plot.lineY(data, { x: "date", y: "articles", stroke: "var(--accent)", strokeWidth: 1.5, curve: "step" }),
      Plot.dot(hits, Plot.dodgeY({ x: "date", r: 2.5, fill: (d) => colorOf(d.cls), anchor: "bottom", padding: 0.5 })),
      Plot.ruleY([0]),
      Plot.tip(data, Plot.pointerX({ x: "date", y: "articles", title: (d) => `${fmtDate(d.date)}: ${d.articles} articles` })),
    ],
  });
  el("coverage").replaceChildren(plot);
  el("coverage-note").innerHTML = `Line: articles per day matching attacks near Hormuz, from <a href="https://www.gdeltproject.org/">GDELT</a>. Dots: attacks in the incident dataset, coloured by outcome. Coverage counts news, not social media.`;
}

/* ---------- Accounts: who is posting (SPEC 1B) ---------- */
// One tag per account. Claude's first pass is data/accounts.csv; Jacob's override (data/account_overrides.csv,
// or saved in this browser and not yet sent) replaces it. Unsure or untagged accounts go to the review queue.
const V = vocab ?? { type: {}, lean: {}, identity: {}, reliability: {}, confidence: {}, flags: {} };
const lc = (h) => String(h ?? "").toLowerCase();
const claudeTags = new Map((accountsRaw ?? []).map((a) => [lc(a.handle), a]));
const repoTags = new Map((overridesRaw ?? []).map((o) => [lc(o.handle), o]));
const profiles = new Map((xusers ?? []).map((u) => [lc(u.username), u]));
const TAGS = "hormuz-account-tags";
let localTags = {};
try { localTags = JSON.parse(localStorage.getItem(TAGS)) ?? {}; } catch {}
// Drop local tags the repo already has (they were sent and applied).
const same = (a, b) => ["type", "lean", "reliability"].every((k) => (a?.[k] ?? "") === (b?.[k] ?? ""));
for (const [h, t] of Object.entries(localTags)) if (t.clear ? !repoTags.has(h) : same(t, repoTags.get(h))) delete localTags[h];
const saveTags = () => { try { localStorage.setItem(TAGS, JSON.stringify(localTags)); } catch {} };

function account(handle) {
  const h = lc(handle), c = claudeTags.get(h);
  const base = c ?? { handle, type: "unknown", lean: "unknown", identity: "unknown", reliability: "unknown", confidence: "low", flags: "", basis: "", notes: "" };
  const o = localTags[h] ? (localTags[h].clear ? null : localTags[h]) : repoTags.get(h);
  if (o) return { ...base, type: o.type || base.type, lean: o.lean || base.lean, reliability: o.reliability || base.reliability, note: o.note, by: "jacob", review: false, unsent: !!localTags[h] };
  return { ...base, by: c ? "claude" : "none", review: !c || base.confidence === "low" || base.type === "unknown" || base.lean === "unknown" };
}
const SERIOUS = ["state", "state_media", "media", "analyst", "verifier"];
const WHO = {
  all: { label: "All accounts", hint: "Everyone", test: () => true },
  serious: { label: "Official, media, analysts", hint: "State, state media, media, analysts, verifiers (reviewed tags only)", test: (a) => !a.review && SERIOUS.includes(a.type) },
  crowd: { label: "Hobbyists, aggregators", hint: "Hobbyists, aggregators, other (reviewed tags only)", test: (a) => !a.review && !SERIOUS.includes(a.type) },
  review: { label: "Needs review", hint: "Claude was unsure or hasn't tagged it", test: (a) => a.review },
};
const leanShown = (l) => l && l !== "none_evident" && l !== "unknown";
function chip(handle) {
  const a = account(handle);
  const label = a.review ? "Needs review" : V.type[a.type] + (leanShown(a.lean) ? ` · ${V.lean[a.lean]}` : "");
  const tip = a.review ? "Claude is unsure or hasn't tagged this account. Tap to tag it."
    : `${a.by === "jacob" ? "Your tag" : `Claude's tag, ${V.confidence[a.confidence] ?? a.confidence} confidence`} · reliability ${V.reliability[a.reliability] ?? a.reliability}${a.notes ? " · " + a.notes : ""}`;
  return `<span class="acct t-${esc(a.review ? "review" : a.type)}${a.by === "jacob" ? " mine" : ""}" role="button" tabindex="0" data-handle="${esc(handle)}" title="${esc(tip)}">${esc(label)}</span>`;
}
// Accounts needing review that actually appear in fetched posts, most-shared first.
function reviewQueue() {
  const eng = d3.rollup(xposts ?? [], (v) => ({ s: d3.sum(v, score), h: v[0].username }), (p) => lc(p.username));
  return [...eng.values()].filter((e) => e.h && account(e.h).review).sort((a, b) => b.s - a.s).map((e) => e.h);
}

const dlg = el("acct-dlg");
const opts = (m, cur) => Object.entries(m).map(([k, l]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
function openTag(handle, back) {
  const a = account(handle), c = claudeTags.get(lc(handle)), u = profiles.get(lc(handle));
  const first = c ? `${V.type[c.type]} · ${V.lean[c.lean]} · reliability ${V.reliability[c.reliability]} · ${V.confidence[c.confidence]} confidence (basis ${esc(c.basis)})` : "not tagged yet";
  const ev = c?.evidence ? (/^https?:/.test(c.evidence) ? `<a href="${esc(c.evidence)}" target="_blank" rel="noopener">evidence</a>` : esc(c.evidence)) : "";
  dlg.innerHTML = `<form method="dialog" class="tag-form">
    <h3><a href="https://x.com/${esc(handle)}" target="_blank" rel="noopener">@${esc(handle)}</a> ${esc(c?.name ?? u?.name ?? "")}</h3>
    ${u ? `<p class="bio">${esc(u.description)}</p><p class="muted">${fmtN(u.followers || 0)} followers · joined ${esc(String(u.created_at).slice(0, 4))}${u.location ? " · " + esc(u.location) : ""}${u.verified_type && u.verified_type !== "none" ? " · " + esc(u.verified_type) + " check" : ""}</p>` : ""}
    <p class="muted">Claude's first pass: ${first}${c?.notes ? ". " + esc(c.notes) : ""} ${ev}</p>
    <label>Type <select name="type">${opts(V.type, a.type)}</select></label>
    <label>Lean <select name="lean">${opts(V.lean, a.lean)}</select></label>
    <label>Reliability <select name="reliability">${opts(V.reliability, a.reliability)}</select></label>
    <label class="wide">Note <input name="note" maxlength="300" value="${esc(a.by === "jacob" ? a.note ?? "" : "")}" placeholder="Why (optional)"></label>
    <div class="row"><button value="save" class="go">Save my tag</button>${a.by === "jacob" ? `<button value="clear">Use Claude's tag</button>` : ""}<button value="cancel">Cancel</button></div>
  </form>`;
  dlg.onclose = () => {
    const f = new FormData(dlg.querySelector("form")), h = lc(handle);
    if (dlg.returnValue === "save") localTags[h] = { handle, type: f.get("type"), lean: f.get("lean"), reliability: f.get("reliability"), note: f.get("note") };
    if (dlg.returnValue === "clear") localTags[h] = { handle, clear: true };
    if (dlg.returnValue === "save" || dlg.returnValue === "clear") { saveTags(); renderSetup(); renderX(); if (location.hash === "#monitor") renderMonitor(); }
    if (back) openQueue();
  };
  dlg.returnValue = ""; dlg.showModal();
}
function openQueue() {
  const q = reviewQueue();
  dlg.innerHTML = `<form method="dialog" class="queue"><h3>Accounts to review (${q.length})</h3>
    <p class="muted">Accounts in the fetched posts that Claude was unsure about or hasn't tagged, most-shared first.</p>
    <ul>${q.map((h) => { const c = claudeTags.get(lc(h)); return `<li><button value="${esc(h)}">@${esc(h)}</button> <span class="muted">${c ? `guess: ${esc(V.type[c.type])}${leanShown(c.lean) ? " · " + esc(V.lean[c.lean]) : ""}` : "untagged"}</span></li>`; }).join("") || "<li>Nothing to review.</li>"}</ul>
    <div class="row"><button value="">Close</button></div></form>`;
  dlg.onclose = () => { if (dlg.returnValue) openTag(dlg.returnValue, true); };
  dlg.returnValue = ""; dlg.showModal();
}
// Saved tags reach the repo through a prefilled issue; an owner-only Action commits them (scripts/apply-account-tags.mjs).
function sendTags() {
  const cell = (v) => (/[",\n]/.test(v ?? "") ? `"${String(v).replace(/"/g, '""')}"` : v ?? "");
  const lines = Object.values(localTags).map((t) => [t.handle, t.type, t.lean, t.reliability, t.note].map(cell).join(","));
  const body = "Account tags from the dashboard. Submit to apply.\n\n```csv\nhandle,type,lean,reliability,note\n" + lines.join("\n") + "\n```\n";
  open(`https://github.com/jjmargolis/straight-tracker/issues/new?${new URLSearchParams({ title: `account-tags (${lines.length})`, body })}`, "_blank", "noopener");
}
document.addEventListener("click", (e) => { const c = e.target.closest(".acct"); if (c) { e.preventDefault(); e.stopPropagation(); openTag(c.dataset.handle); } }, true);
document.addEventListener("keydown", (e) => { const c = e.target.closest?.(".acct"); if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openTag(c.dataset.handle); } });

// X spend: the fetcher counts units of $0.005 (post 1, media 1, author lookup 2). Jacob's balance is a prepaid $10.
function renderSpend() {
  const units = budget?.units ?? budget?.reads;
  if (!units) { el("m-spend").textContent = ""; return; }
  const usd = units * 0.005, perDay = usd / new Date().getUTCDate(), left = Math.max(0, 10 - usd);
  el("m-spend").innerHTML = `X spend this month ≈ <b>$${usd.toFixed(2)}</b> of $10 · ~$${perDay.toFixed(2)}/day${perDay > 0 ? ` · lasts ~${Math.floor(left / perDay)} more days` : ""}`;
  el("m-spend").title = `Estimate from data/x_budget.json (${budget.posts ?? "?"} posts, ${budget.users ?? "?"} author lookups, ${budget.media ?? "?"} media). The X developer console has the real balance.`;
}

/* ---------- Monitor: a wall of embedded X posts, set up from the dashboard ---------- */
// Posts come from the X fetch (a few batches a day). Each tile is X's official embed, so video plays inline.
// Until the embed loads (or if X's script is blocked) the tile shows our own preview.
const WINDOWS = [[1, "24h"], [7, "7 days"], [30, "30 days"]];
const termList = () => state.terms.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
const matches = (...fields) => { const t = termList(); if (!t.length) return true; const h = fields.join(" ").toLowerCase(); return t.some((w) => h.includes(w)); };
const isVideo = (p) => p.media_type === "video" || p.media_type === "animated_gif";

function renderSetup() {
  el("m-window").innerHTML = WINDOWS.map(([d, l]) => `<button data-days="${d}" aria-pressed="${state.xWindow === d}">${l}</button>`).join("");
  el("m-window").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.xWindow = +b.dataset.days; save(); renderSetup(); renderX(); } };
  renderTopStrip();
  const terms = el("m-terms");
  if (document.activeElement !== terms) terms.value = state.terms;
  terms.oninput = () => { state.terms = terms.value; save(); renderTopStrip(); };
  const v = el("m-video");
  v.setAttribute("aria-pressed", !!state.videoOnly);
  v.onclick = () => { state.videoOnly = !state.videoOnly; save(); renderSetup(); };
  el("m-who").innerHTML = Object.entries(WHO).map(([k, w]) => `<button data-who="${k}" aria-pressed="${state.who === k}" title="${esc(w.hint)}">${w.label}</button>`).join("");
  el("m-who").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.who = b.dataset.who; save(); renderSetup(); } };
  const q = reviewQueue(), pend = Object.keys(localTags).length;
  el("m-review").textContent = `Review accounts (${q.length})`;
  el("m-review").onclick = openQueue;
  el("m-send").hidden = !pend;
  el("m-send").textContent = `Send ${pend} tag${pend === 1 ? "" : "s"} to repo`;
  el("m-send").onclick = sendTags;
  renderSpend();
}

function monitorPosts() {
  const since = Date.now() - state.xWindow * 864e5;
  return (xposts ?? []).map((p) => ({ ...p, id: String(p.id), created: new Date(p.created_at) }))
    .filter((p) => p.created >= since && matches(p.text, p.username, p.name) && (!state.videoOnly || isVideo(p)) && WHO[state.who].test(account(p.username)));
}

// Top posts strip in the setup bar: click one to open the wall with that post first.
function renderTopStrip() {
  const top = monitorPosts().sort((a, b) => score(b) - score(a)).slice(0, 12);
  el("m-top").innerHTML = top.map((p) => `<button class="top-post" data-id="${esc(p.id)}" title="Open in the monitor">
    <div class="thumb" style="${p.preview ? `background-image:url('${esc(p.preview)}')` : ""}">${isVideo(p) ? `<span class="play">▶ video</span>` : ""}</div>
    <div class="meta"><b>${fmtN(score(p))}</b>${Number.isFinite(p.views) ? " views" : " score"}<span>@${esc(p.username)}</span></div>
    ${chip(p.username)}
    <div class="t">${esc(p.text)}</div></button>`).join("");
  el("m-top").onclick = (e) => { if (e.target.closest(".acct")) return; const b = e.target.closest("[data-id]"); if (b) { state.pin = b.dataset.id; location.hash = "#monitor"; } };
}

let widgets;
const loadWidgets = () => (widgets ??= new Promise((resolve) => {
  const s = Object.assign(document.createElement("script"), { src: "https://platform.twitter.com/widgets.js", async: true });
  s.onload = () => (window.twttr?.ready ? twttr.ready(resolve) : resolve(null));
  s.onerror = () => resolve(null);
  document.head.append(s);
  setTimeout(() => resolve(window.twttr ?? null), 8000);
}));
const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

const embedObs = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    embedObs.unobserve(e.target);
    const tile = e.target;
    loadWidgets().then((tw) => tw?.widgets?.createTweet(tile.dataset.id, tile, { theme: dark() ? "dark" : "light", dnt: true, conversation: "none", align: "center" })
      .then((node) => { if (node) { tile.querySelector(".ph")?.remove(); tile.classList.add("embedded"); } }));
  }
}, { rootMargin: "800px 0px" });

const tileHtml = (p) => `<div class="tile" data-id="${esc(p.id)}"><div class="tile-acct">${chip(p.username)}</div><a class="ph" href="${esc(p.url)}" target="_blank" rel="noopener">
  <div class="who"><b>${esc(p.name)}</b> @${esc(p.username)} · ${ago(p.created)}${isVideo(p) ? ` · <span class="vid">▶ VIDEO</span>` : ""}</div>
  <div class="txt">${esc(p.text)}</div>
  ${p.preview ? `<img src="${esc(p.preview)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</a></div>`;

let wall = { posts: [], shown: 0, cols: [] };
const PAGE = 16;
function wallColumns() { return Math.max(1, Math.min(4, Math.floor((innerWidth - 16) / 260))); }

function renderMonitor() {
  const win = WINDOWS.find(([d]) => d === state.xWindow)?.[1] ?? `${state.xWindow}d`;
  const t = termList();
  const pinned = (p) => (p.id === state.pin ? 1 : 0);
  const posts = monitorPosts().sort((a, b) => (pinned(b) - pinned(a)) || (isVideo(b) - isVideo(a)) || score(b) - score(a));
  el("m-summary").textContent = `${posts.length} posts · last ${win}${t.length ? ` · matching ${t.join(", ")}` : ""}${state.videoOnly ? " · videos only" : " · videos first"}${state.who !== "all" ? ` · ${WHO[state.who].label.toLowerCase()}` : ""}`;
  const fetched = d3.max(xposts ?? [], (p) => new Date(p.fetched_at));
  el("m-asof").textContent = fetched ? `X batch ${ago(fetched)} ago` : "";
  const n = wallColumns();
  el("m-wall").innerHTML = Array.from({ length: n }, () => `<div class="wall-col"></div>`).join("");
  wall = { posts, shown: 0, cols: [...el("m-wall").children] };
  if (!posts.length) el("m-wall").innerHTML = `<p class="empty">${xposts?.length ? "No posts match these settings. Widen the window or clear keywords." : "No X posts fetched yet."}</p>`;
  more();
}
function more() {
  const next = wall.posts.slice(wall.shown, wall.shown + PAGE);
  next.forEach((p, i) => {
    const col = wall.cols[(wall.shown + i) % wall.cols.length];
    col.insertAdjacentHTML("beforeend", tileHtml(p));
    embedObs.observe(col.lastElementChild);
  });
  wall.shown += next.length;
  el("m-more").innerHTML = wall.posts.length && wall.shown >= wall.posts.length ? `<p class="m-end">That's everything in this window.</p>` : "";
}
new IntersectionObserver((e) => { if (e[0].isIntersecting && location.hash === "#monitor" && wall.shown < wall.posts.length) more(); }, { rootMargin: "1200px 0px" }).observe(el("m-more"));
let lastCols = 0;
addEventListener("resize", () => { if (location.hash === "#monitor" && wallColumns() !== lastCols) { lastCols = wallColumns(); renderMonitor(); } });

async function refreshMedia() {
  const x = await csv(`data/x_posts.csv?t=${Date.now()}`);
  if (x && x.length !== xposts?.length) { xposts = x; renderMonitor(); }
}

let refreshTimer;
function route() {
  const on = location.hash === "#monitor";
  document.body.classList.toggle("monitoring", on);
  el("monitor").hidden = !on;
  clearInterval(refreshTimer);
  if (on) { scrollTo(0, 0); lastCols = wallColumns(); renderMonitor(); refreshTimer = setInterval(refreshMedia, 10 * 60e3); }
  else { state.pin = null; renderX(); }
}
addEventListener("hashchange", route);

function renderAll() {
  renderFilters(); renderKpis(); renderMap(); renderMonthly(); renderTable();
}

const updated = d3.max(incidents, (d) => d.date);
el("asof").textContent = `Latest incident: ${fmtDate(updated)}`;
renderSetup(); renderAll(); renderFlow(); renderTransits(); renderX(); renderNews(); renderCurated(); renderCoverage(); route();

let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { renderMap(); renderFlow(); renderTransits(); renderMonthly(); renderCoverage(); }, 150); });
