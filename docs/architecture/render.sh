#!/usr/bin/env bash
# Re-render every docs/architecture/*.mmd to SVG with the pinned Mermaid CLI.
# Needs Node and a Chrome/Chromium (set PUPPETEER_EXECUTABLE_PATH if mmdc can't find one).
set -euo pipefail
cd "$(dirname "$0")"
for f in *.mmd; do
  npx -y -p @mermaid-js/mermaid-cli@11.4.2 mmdc -i "$f" -o "${f%.mmd}.svg" -c mermaid.json -b white
done
