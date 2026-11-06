#!/usr/bin/env bash
# Re-render docs/architecture/*.mmd to SVG.
# Mermaid CLI is pinned; the ELK layout (bundled with it) gives right-angle edges.
# postprocess.mjs only changes paint order so box titles sit above the lines.
# Needs Node 18+ and a Chrome/Chromium; set PUPPETEER_EXECUTABLE_PATH if mmdc can't find one.
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mmd; do
  npx -y -p @mermaid-js/mermaid-cli@11.17.0 mmdc -i "$f" -o "${f%.mmd}.svg" -c mermaid.json -b white
  node postprocess.mjs "${f%.mmd}.svg"
done
