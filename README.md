# Strait of Hormuz tracker

A static dashboard of oil flow through the Strait of Hormuz and attacks on shipping, with a source for every number.

- **Live site:** GitHub Pages (Settings → Pages → deploy from `main`, root).
- **Spec and decisions:** [SPEC.md](SPEC.md).

## Run locally

```
python -m http.server 8000
```
Then open http://localhost:8000. No build step and no npm install. d3 and Observable Plot are vendored in `vendor/`.

## Data

| File | What | Updated by |
|---|---|---|
| `data/incidents.csv` | One row per vessel per event | Pull requests (curated, never auto-merged) |
| `data/incident_sources.csv` | Every source for each incident, with what it claimed | Pull requests |
| `data/flow_eia.csv` | EIA oil-flow estimates, mb/d | By hand when EIA publishes |
| `data/transits_portwatch.csv` | IMF PortWatch daily tanker transits | GitHub Action, daily |
| `data/land.json` | Natural Earth 1:10m coastline, clipped | `scripts/clip-land.mjs`, one-off |

Check data before committing:
```
node scripts/validate.mjs
```
