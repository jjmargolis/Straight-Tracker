// Moves Mermaid cluster titles above the edge layer so lines entering a box never cross its title.
// Mermaid draws clusters first and edges on top; cluster-label groups use absolute transforms,
// so lifting them to the end of the root group changes paint order only, not position.
// Usage: node postprocess.mjs file.svg
import fs from "node:fs";
const file = process.argv[2];
let s = fs.readFileSync(file, "utf8");
const lifted = [];
for (let i; (i = s.indexOf('<g class="cluster-label"')) !== -1; ) {
  let depth = 0, j = i;
  const re = /<g[\s>]|<\/g>/g; re.lastIndex = i;
  for (let m; (m = re.exec(s)); ) { depth += m[0] === "</g>" ? -1 : 1; if (depth === 0) { j = m.index + 4; break; } }
  lifted.push(s.slice(i, j).replace('<g class="cluster-label"', '<g class="cluster-label lifted"'));
  s = s.slice(0, i) + s.slice(j);
}
const root = s.indexOf('<g class="root">');
if (root === -1 || !lifted.length) { fs.writeFileSync(file, s); process.exit(0); }
// close of the root group = the last </g> before </svg>
const end = s.lastIndexOf("</g>", s.lastIndexOf("</svg>"));
s = s.slice(0, end) + `<g class="cluster-titles">${lifted.join("")}</g>` + s.slice(end);
fs.writeFileSync(file, s);
console.log(`${file}: lifted ${lifted.length} cluster titles`);
