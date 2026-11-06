# Hormuz Dashboard: SPEC

Status: **v0.9** (2026-11-06). Living document, updated as work proceeds.
Owner: Jacob. Repo: [`jjmargolis/straight-tracker`](https://github.com/jjmargolis/straight-tracker).

Evidence tags used throughout:
- **[R]** = read during research on 2026-11-06, with link.
- **[M]** = from model memory, not verified this session. Treat as a lead, not a fact.
- **[U]** = unverified / open question.

---

## 1. Goal

A single-page, clean, mobile-friendly dashboard on the Strait of Hormuz. Centerpiece:

1. **Oil volume through the strait** over time (pre-war baseline vs now).
2. **Ships hit and sunk**, current conflict plus history.
3. **Map** with overlays of hit and sinking locations.

Data refreshes periodically and automatically. Historical data matters, especially sinkings.

### Context (why this is timely)
- The 2026 Iran war began **28 Feb 2026** with US/Israeli strikes; attacks on merchant ships began 1 Mar. [R: [Wikipedia, 2026 Strait of Hormuz crisis](https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis)]
- Ships were sunk in the strait in mid-October 2026. [R, headline only: [Washington Post 2026-10-14](https://www.washingtonpost.com/world/2026/10/14/iranian-attack-sinks-container-ship-strait-hormuz/), [US News 2026-10-14](https://www.usnews.com/news/world/articles/2026-10-14/container-ship-sinks-near-hormuz-after-being-hit-by-projectile-sources-say)]
- UKMTO weekly dashboard (week ending 16 Oct 26): 135 events reported YTD, 114 damage reports, outcomes 6 total loss / 24 required assistance / 105 continued voyage. UKMTO itself says most attacked vessels **do not report**, so true counts are higher. [R: screenshot of UKMTO weekly dashboard supplied by Jacob]

### Prior art (and why build this anyway)
- [hormuz.now](https://hormuz.now/oil) already tracks daily crossings (AIS), oil-flow estimates (citing Kpler via CNN, EIA, IEA, Windward), with a daily CSV. It has a live ship map but **no map of attack locations** as far as the page shows. [R]
- **Differentiator for us:** an attack/sinking map with *history* (2019 incidents, 1980s Tanker War) and an explicit source + confidence for every number.

---

## 1A. Refocus (v0.7, Jacob 2026-11-06): media tracker first

**New centerpiece:** a tracker of the media coming out of the region about strikes (footage, posts, articles), showing what is getting attention, tied to incidents where possible. The strait numbers (oil flow, transits, official incident tallies) stay, as a smaller panel fed by **free official periodic reports**.

### What "lighting up the internet" can honestly mean with free data
Attention is measured by engagement, and the platforms where strike footage spreads (X, Telegram) either charge or have no public API. So:

| Signal | Source | Cost | What it measures | Status |
|---|---|---|---|---|
| News volume over time, articles list | **GDELT DOC 2.0 API** (`timelinevolraw`, `artlist`, filter by keyword/country/theme, ~3-month lookback) | Free, no key in examples | Volume of *news coverage*, not social virality | [R: [gdelt-doc-api](https://github.com/kepler471/gdelt-doc-api)] Not yet tested from GitHub Actions |
| X posts + engagement | X API pay-per-use, **$0.005 per post read** (no free read tier) | ~$5 per 1,000 posts | What is actually spreading | [R: [opentweet, checked against docs.x.com 2026-10-10](https://opentweet.io/x-api-pricing)] **Approved by Jacob: cap ~$10/month (~2,000 reads)**. Token stored as repo secret `X_BEARER_TOKEN`; the fetch script enforces a monthly read budget. |
| Bluesky posts | `app.bsky.feed.searchPosts` | Free | Smaller audience, but open | [U: auth requirements not verified] |
| YouTube videos | YouTube Data API | Free quota with a Google API key | Uploads and view counts for strike footage | [M: quota ~10k units/day; verify] |
| Telegram channels (IRGC-aligned, OSINT) | Public channel web previews | Free, no API | Often the *first* place footage appears | [M] Manual or Claude-assisted; no automated scraping |
| Curated finds | Jacob (X, YouTube incl. WGOWS) + daily Claude news search | Free | Judgement, not a metric | Already in spec |

**Honest framing in the UI:** "Coverage volume" (GDELT) and "Most-shared items" (only if X/YouTube counts are fetched) are labelled separately. Nothing is called "trending" without an engagement number behind it.

### Media items: data model
`data/media.csv`
```
id,found_at,published_at,platform,url,author,kind,title,lang,incident_id,
verification,engagement,engagement_at,found_by,notes
```
- `kind`: `video` | `image` | `post` | `article`
- `incident_id`: links to `incidents.csv` when the item shows or reports a known incident; blank if unmatched. An item with new information can *create* an incident row at `confidence=claimed`.
- `verification`: `unreviewed` | `matches_incident` (time/place consistent with a sourced incident) | `geolocated` (location confirmed from visual features, by us or a named OSINT source) | `recycled` (older footage or another conflict) | `fabricated`. Recycled and fabricated items are **kept and shown as such**: during this war both sides push fakes, and debunks are part of the story.
- `engagement`: views/likes/reposts snapshot where a free or paid API gives it, with `engagement_at` timestamp.
- `found_by`: `claude_routine` | `jacob` | `gdelt` | `api`.

**Copyright:** link and embed only (platform embeds for X, YouTube, Bluesky, Telegram). Never rehost video or images in the repo.

### Official periodic reports (the "strait numbers" panel)
| Report | Cadence | Gives |
|---|---|---|
| UKMTO weekly report / dashboard | Weekly | Incident tally, outcomes, positions [R] |
| JMIC advisories | Weekly-ish | Threat level per region [R] |
| EIA STEO | Monthly | Hormuz flow by quarter [R] |
| IMF PortWatch | Daily, 3–5 day lag | Tanker transits [R] |
| US MARAD MSCI advisories | As issued | US-flag guidance [M: verify current URL] |

A weekly Claude routine reads these and opens a PR updating the numbers and adding any new incidents.

### Civil infrastructure (Jacob, 2026-11-06)
Explicitly in scope alongside ships: ports, oil terminals, refineries, desalination plants, power plants and the grid, undersea cables, airports and pipelines around the Gulf and Gulf of Oman.
- `incidents.csv` gains a last column `target`: `vessel | port | oil_terminal | refinery | desalination | power | cable | airport | other_infrastructure`. For non-vessel targets `vessel_name` holds the facility name; `imo` and `flag` stay blank.
- Map draws infrastructure as squares; the table and detail panel show the target; ship KPIs exclude infrastructure, which gets its own tile once any rows exist.
- X rotation adds I1 (EN), I2 (AR), I3 (FA) infrastructure queries with engagement floors (20/10/10). Same 15 posts per run, so spend is unchanged; each query now comes round every ~3.75 days instead of ~3.
- Terms in I1–I3 are from model memory [M], not yet checked against the source catalog.

### Screen targets (Jacob, 2026-11-06)
Landscape only: laptop and phone held horizontally (S24 Ultra landscape is about 915 CSS px wide). Portrait phone layout is out of scope: no design or testing effort goes into it. The existing CSS still stacks columns below 860px, which costs nothing to keep.

### UI (proposed v1 of the refocus)
1. **Media feed** (centerpiece): newest first, embed card per item, badges for verification and linked incident, filter by platform/verification.
2. **Coverage volume** chart: GDELT daily article count for Hormuz-strike queries, with incident dates marked, so spikes can be read against events.
3. **Map**: incidents as now; incidents with media get a marker ring, click shows the media.
4. **Strait numbers** strip: oil flow, transits, UKMTO tally, JMIC threat levels, each with "as of" date.
5. **Monitor mode** (Jacob, v0.8b): a setup bar on the dashboard sets the time window (24h/7d/30d), keywords (comma-separated, OR) and "videos only". "Open monitor" goes to `#monitor`: a scrolling wall of X posts, 4 across on a laptop (3 on a landscape phone, since X embeds need ~250px), videos first, then by views. Each tile is X's official embed (widgets.js, `dnt: true`), so video plays inline; tiles load as they scroll near. It is **not live X**: it shows what the fetch collected (~60 posts/day on the $10 cap). News and incidents stay on the dashboard.
6. **X fetch**: every 6 h, one query per run (15 posts) from `scripts/x-queries.json`, rotating precise (Q1–Q5) and wide-net (W1–W5) queries in EN/AR/FA/HE/ZH plus ground-truth (Q6) and footage carriers (Q8), from research/source-catalog.md. Each post records which query found it.

---

## 2. Data sources

### 2.1 Oil volume

Honest constraint: **no free source gives real-time barrels through Hormuz.** Kpler and Vortexa (the tanker-tracking firms everyone cites) are paid. So the dashboard shows two things and labels them clearly.

| Source | What | Granularity | Access | Role |
|---|---|---|---|---|
| **EIA Short-Term Energy Outlook (STEO)** | Hormuz crude + petroleum liquids flow, mb/d. Built on Vortexa tracking. 4Q25 = **21.6 mb/d**, 2Q26 = **4.9 mb/d**. | Quarterly, published monthly | Free | **Official volume series** (headline number) [R: [Rigzone on Aug 2026 STEO](https://www.rigzone.com/news/how_much_oil_transited_through_worlds_chokepoints_in_2q-12-aug-2026-184358-article/?rss=true)] |
| **EIA World Oil Transit Chokepoints** | Annual Hormuz flow ~20–21 mb/d, 2018–2024 | Annual | Free | Long historical baseline. [M: ~20 mb/d in 2024, ~20% of world liquids consumption. Verify exact table before use.] |
| **IMF PortWatch, Daily Chokepoint Transits** | Daily transit counts by vessel type incl. tankers, plus capacity (dwt), from AIS. ArcGIS FeatureServer `Daily_Chokepoints_Data`. | Daily, ~3–5 day lag | Free, open API | **Daily proxy** (tanker transits and tanker dwt). [R: service exists ([metadata](https://services9.arcgis.com/weJ1QsnbMYJlCHdG/ArcGIS/rest/services/Daily_Chokepoints_Data/FeatureServer/info/metadata)); lag per hormuz.now. Field names e.g. `n_tanker`, `capacity_tanker` are M/U until queried.] |
| Kpler / Vortexa / Lloyd's List Intelligence | Barrels and transits, best quality | Daily | **Paid** | Out of scope. Quote their published numbers only when a news source cites them. |

Known measurement problems [R: [Al Jazeera 2026-09-03](https://www.aljazeera.com/news/2026/9/3/how-much-oil-is-going-through-hormuz-how-data-doesnt-match-us-claims)]:
- Sources disagree on transit counts because of **scope** (Lloyd's counts cargo ships >10,000 dwt; US counts may include tugs and dhows) and **dark transits** (AIS off). AIS counts are a floor and get revised upward later.
- US government barrel claims (10–18 mb/d) were far above tracker counts at the time.

**Design decision:** headline = EIA quarterly (authoritative, lagging). Daily line = PortWatch tanker transits (fast, a proxy, labeled "AIS floor"). We do **not** convert dwt to barrels ourselves unless we can cite a conversion method; inventing one would be false precision.

### 2.2 Incidents (hits, sinkings)

| Source | Coverage | Coordinates? | Access | Role |
|---|---|---|---|---|
| **UKMTO weekly report / dashboard** | 28 Feb 2026 onward, Hormuz / Arabian Gulf / Gulf of Oman | **Yes**, deg-min positions, approximate ones flagged | PDF/web, no API found | **Primary source for 2026 positions.** [R: Jacob's screenshot; [UKMTO products](https://www.ukmto.org/indian-ocean/ukmto-products) page describes weekly reports and per-incident advisories but no feed] |
| **JMIC** advisories | Threat levels per region (e.g. Hormuz "Severe") | No | PDF | Threat-level tiles. [R: screenshot; [Steamship Mutual hosts JMIC PDFs](https://www.steamshipmutual.com/sites/default/files/medialibrary/files/JMIC%20Week%2023%20Dashboard%202%20JUNE%20-%208%20JUNE%202025%201.pdf)] |
| **Wikipedia, List of ships attacked during the 2026 Iran war** | ~73 entries, commercial + naval | **No** (text like "5 nm north of Khasab") | Free, CC BY-SA | Cross-check, names, outcomes, citations. Notes conflicting sources (e.g. IRIS Makran). [R: [link](https://en.wikipedia.org/wiki/List_of_ships_attacked_during_the_2026_Iran_war)] |
| **NGA ASAM** (Anti-Shipping Activity Messages) | Hostile acts against ships, decades of history | **Yes**, lat/lon | Free, US gov, updated daily | **Historical backbone with coordinates.** [R: fields date, lat, lon, hostility, victim, description per [hrbrmstr/asam](https://github.com/hrbrmstr/asam). M: covers back to ~1978 and has an API at msi.nga.mil. U: whether 2026 war incidents are logged.] |
| Tanker War 1984–88 | Hundreds of ships attacked in the Gulf | Partial | Secondary literature | Historical layer. [M: roughly 400+ ships attacked, a few dozen sunk or total loss. Numbers vary by source; must cite a specific scholarly source before display.] |
| 2019–2021 incidents | Fujairah (May 2019), Gulf of Oman tankers (June 2019), Stena Impero seizure, Mercer Street (2021) | Approximate | News + ASAM | Historical layer. [R: [Wikipedia, June 2019 Gulf of Oman incident](https://en.wikipedia.com/wiki/June_2019_Gulf_of_Oman_incident) exists; details M] |

**Hard truth:** there is no clean machine-readable incident feed for 2026. The incident dataset will be a **curated CSV in the repo**, one row per event, each with a source URL. That is the core asset of this project.

---

## 3. Data model

`data/incidents.csv` (one row per vessel per event)
```
id,date,vessel_name,imo,vessel_type,flag,lat,lon,position_quality,location_text,
event_type,outcome,deaths,casualties,attacker,conflict,confidence,
source_primary,source_url,notes
```
- `location_text`: the source's position wording, verbatim. `lat/lon`: decimal degrees, blank if no source gives a usable position.
- `deaths`: integer or blank. `casualties`: free text.
- `attacker`: `iran` | `us` | `israel` | `unknown` (the US has also sunk vessels, e.g. Kylo and Riesco in Sep 2026).
- `position_quality`: `reported` | `approximate` | `inferred` (computed from text like "5 nm N of Khasab") | `unknown` (no lat/lon). Map: solid = reported, hollow = approximate/inferred; unknown appears in the table only.
- `event_type`: `attack` | `near_miss` | `seizure` | `mine` | `suspicious` | `advisory`
- `outcome`: `sunk` | `total_loss` | `disabled` | `damaged` | `continued` | `unknown`
- `conflict`: `tanker_war_1984_88` | `2019_2021` | `iran_war_2026`
- UKMTO reference (e.g. `173-26`) kept in `id` where available.
- `confidence`: `confirmed` (UKMTO/JMIC/CENTCOM, or 2+ independent outlets) | `reported` (one credible outlet) | `claimed` (social media, or a belligerent's own claim). Map and KPIs default to `confirmed` + `reported`; `claimed` is a toggle.

**Manual / social-media ingest (Jacob, occasional X posts):** same CSV, same schema, `confidence=claimed`, `source_url` = the post. Worth it for one reason: UKMTO says most attacked ships don't report, so OSINT posts often come first and carry geolocated video. A row is promoted to `reported`/`confirmed` when a better source appears; it is never deleted, only re-rated. Entry path: a short form or just a row added via PR, validated by the same CI check. Rationale for keeping claims in the dataset but hidden by default: during this war both sides have reasons to inflate (see Al Jazeera above), so claims are signal about *where to look*, not counts.

### 3.1 Source trail (one incident, many sources)

Underreporting is structural, not noise: UKMTO's own weekly comment says the "majority of vessels attacked [are] refusing to report" [R: Jacob's UKMTO screenshot], and Sal (What's Going On With Shipping) says companies tell crews not to report [R: secondhand via Jacob, 2026-11-06]. So no single source is the dataset. Every incident keeps the full trail:

`data/incident_sources.csv`
```
incident_id, source_name, source_type, url, published, claim, lat, lon, notes
```
- `source_type`: `official` (UKMTO, JMIC, CENTCOM, IMO, flag state) | `security_firm` (Ambrey, Windward, Vanguard) | `trade_press` (Lloyd's List, gCaptain, Seatrade, TradeWinds) | `news` (Reuters, AP, etc.) | `osint` (X posts, YouTube incl. WGOWS, geolocated video) | `ais` (AIS gaps or anomalies, from PortWatch or a tracker) | `belligerent` (IRGC, Iranian or US government claims)
- `claim`: what *this* source says (e.g. "struck, fire on deck", "sank"). Sources are allowed to disagree; the disagreement is shown, not resolved silently.
- `incidents.csv` stays one row per event, with fields derived from the trail: `confidence` is computed (see above), and `lat/lon` taken from the most precise official or security-firm source, else the best OSINT geolocation.
- In the UI, clicking an incident shows the trail as a list: source, date, what it said, link.
- Dedup rule: two reports are the same incident if same vessel (name or IMO), or same day and within ~10 nm with matching vessel type. Ambiguous cases are kept separate and flagged for review.

`data/flow_eia.csv`: `period,start,end,mbd,kind,source,source_url,notes`
`data/transits_portwatch.csv`: `date, n_tanker, n_total, capacity_tanker` (exact fields TBC on first query)

---

## 4. Dashboard layout (v1)

Inspired by the UKMTO weekly dashboard, simplified.

1. **KPI row**: oil flow now vs pre-war (EIA, % of baseline) · ships hit since 28 Feb · ships sunk / total loss · seafarer deaths · days since conflict start. Each tile has a source footnote and "as of" date.
2. **Oil chart**: EIA quarterly bars + PortWatch daily tanker-transit line, pre-war baseline band.
3. **Map** (centerpiece with the oil chart): incidents as points, color = outcome, hollow = approximate position. Filter by conflict era and date range. Click = details + source link.
4. **Incidents by month** small chart, and an incident table (sortable, links to sources).

Not in v1: live AIS ship positions (hormuz.now does this; heavy and adds little).

---

## 5. Stack (proposal)

Diagrams of the built system, with every source, job, file and trust boundary: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Principle: no server, no database, no build step unless it pays for itself.

- **Static site** on **GitHub Pages**: `index.html` + one JS module + CSS. Free, fast on a phone.
- **Charts and map: Observable Plot only** (decided v0.5). The map is a Plot geo projection over a Natural Earth 1:10m coastline clipped to the Gulf (46 KB, `data/land.json`). Why not Leaflet: no tile server, no API key, no third-party requests, identical styling to the charts, dark mode for free. Cost: no pinch-zoom; instead two fixed views (Strait, Whole Gulf). Revisit if the map needs free zoom.
- Libraries are vendored in `vendor/` (d3 7.9.0, Plot 0.6.17), so the site has zero runtime dependencies on CDNs.
- **Data refresh**: **GitHub Actions cron**.
  - Daily: fetch PortWatch, commit `transits_portwatch.csv`.
  - Monthly: check EIA STEO, update `flow_eia.csv` (may need a manual step if EIA only publishes this in PDF/text).
  - Incidents: a **scheduled Claude routine** (daily) searches news, UKMTO/JMIC releases, trade press and security-firm posts, then opens a **pull request** with new or updated rows in `incidents.csv` and `incident_sources.csv`, every row with its URL. A GitHub Action can't do this well because the inputs are prose and PDFs, not feeds. Jacob reviews and merges. Never auto-merge incident data; misreported sinkings are the failure that matters.
- **Validation**: `scripts/validate.mjs` checks headers, enums, dates, lat/lon in the region box, IMO format, and that every incident has at least one source row. Runs in CI on every PR and push.

---

## 6. Open questions

1. ~~Repo~~: `jjmargolis/straight-tracker`. Needs GitHub Pages turned on (Settings → Pages → deploy from `main`, root).
2. How far back for sinkings: start with 2019+ and 2026, then add the Tanker War layer once a citable dataset is found?
3. Do we count Iranian naval vessels sunk by the US, or merchant shipping only? (Suggest: merchant default, naval as a toggle.)
4. Verify PortWatch and ASAM APIs from a network that allows them (this build environment's proxy blocked both on 2026-11-06).

---

## Changelog
- 2026-11-06 v0.9: civil infrastructure in scope: `target` column, infrastructure X queries, map squares.
- 2026-11-06 v0.8b: monitor becomes a wall of embedded X posts (videos inline); X fetch rotates 12 multilingual queries, 4 runs/day, same cap.
- 2026-11-06 v0.8: monitor mode (4 full-screen columns) driven by a setup bar on the dashboard.
- 2026-11-06 v0.1: initial research and proposal.
- 2026-11-06 v0.2: added `confidence` field and manual X/Twitter ingest path.
- 2026-11-06 v0.3: multi-source trail per incident (`incident_sources.csv`), source types, dedup rule.
- 2026-11-06 v0.4: daily Claude news-search routine opens incident PRs.
- 2026-11-06 v0.5: repo is `straight-tracker`; map moved from Leaflet to Plot geo; final incidents schema (`location_text`, `deaths`, `attacker`, `unknown` position); first build (seed data only).
- 2026-11-06 v0.7c: landscape only; portrait phone dropped.
- 2026-11-06 v0.7b: Jacob approved X API at ~$10/month cap.
- 2026-11-06 v0.7: refocus on media tracker (section 1A): media.csv schema, verification states, free attention signals (GDELT), optional paid X API, official-report panel.
- 2026-11-06 v0.6: ingested research-thread dataset v0.1 (151 incidents, 275 sources). UKMTO screenshot rows merged only when vessel name or a unique date+type match; otherwise kept and flagged POSSIBLE DUPLICATE (5 rows), so counts may be overstated by up to 5. Naval toggle added. `landmarks.csv` coordinates are from model memory, so every `inferred` position is approximate.
