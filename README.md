# Situation Monitor

A static dashboard of oil flow through the Strait of Hormuz and attacks on shipping, with a source for every number.

- **Live site:** GitHub Pages (Settings → Pages → deploy from `main`, root).
- **Spec and decisions:** [SPEC.md](SPEC.md).
- **Architecture diagrams:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
| `data/media.csv` | Curated footage/posts with a verification label | Pull requests |
| `data/x_posts.csv` | Top X posts with engagement counts | GitHub Action, daily, budget-capped (`data/x_budget.json`) |
| `data/x_users.csv` | Profile of each X author seen (bio, followers, join date), looked up once | GitHub Action, with the X fetch |
| `data/accounts.csv`, `data/account_vocab.json` | Who each author is: type, lean, reliability, with basis and evidence (SPEC 1B) | Claude, by pull request |
| `data/account_overrides.csv` | Jacob's tags, which replace Claude's | Dashboard → GitHub issue → Action |
| `data/coverage_gdelt.csv`, `data/gdelt_articles.csv` | News volume per day and latest articles | GitHub Action, every 6 h |
| `data/land.json` | Natural Earth 1:10m coastline, clipped | `scripts/clip-land.mjs`, one-off |

Check data before committing:
```
node scripts/validate.mjs
```

## Secrets

- `X_BEARER_TOKEN`: X API pay-per-use bearer token. Without it the X step is skipped. Spend is capped at 1,800 posts a month (about $9).
