// One-off: regenerates data/land.json from world-atlas land-10m. Run with d3-geo, topojson-client, world-atlas installed.
import { geoIdentity } from "d3-geo";
import { feature } from "topojson-client";
import fs from "fs";
const [x0,y0,x1,y1] = [47.5, 22, 60.5, 30.5];
const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/land-10m.json"));
const land = feature(topo, topo.objects.land);
// identity projection with clipExtent clips in lon/lat space
const proj = geoIdentity().clipExtent([[x0,y0],[x1,y1]]);
const polys = []; let poly, ring;
const r = v => Math.round(v*1000)/1000;
const sink = {
  polygonStart(){ poly = []; }, polygonEnd(){ if (poly.length) polys.push(poly); poly = null; },
  lineStart(){ ring = []; }, lineEnd(){ if (ring.length>3){ ring.push(ring[0]); (poly ?? (polys.push([ring]), [])).push?.(ring);} ring=null; },
  point(x,y){ ring.push([r(x),r(y)]); }, sphere(){},
};
// fix: lines outside polygons won't happen for land
const s = proj.stream({...sink, lineEnd(){ if (ring.length>2){ ring.push(ring[0]); poly.push(ring);} ring=null; }});
for (const f of land.features) { const g = f.geometry;
  const list = g.type==="Polygon" ? [g.coordinates] : g.coordinates;
  for (const p of list) { s.polygonStart(); for (const rr of p){ s.lineStart(); for (const pt of rr) s.point(pt[0],pt[1]); s.lineEnd(); } s.polygonEnd(); } }
// drop consecutive duplicate points
const dedup = ring => ring.filter((p,i)=> i===0 || p[0]!==ring[i-1][0] || p[1]!==ring[i-1][1]);
const out = { type:"Feature", properties:{source:"Natural Earth 1:10m land via world-atlas@2.0.2, clipped to "+[x0,y0,x1,y1].join(",")}, geometry:{ type:"MultiPolygon", coordinates: polys.map(p=>p.map(dedup)).filter(p=>p[0].length>3) } };
fs.writeFileSync("land.json", JSON.stringify(out));
console.log(out.geometry.coordinates.length, fs.statSync("land.json").size);
