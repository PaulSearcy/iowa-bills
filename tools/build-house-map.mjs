#!/usr/bin/env node
// Embed Iowa House district boundaries as SVG paths in midterm/IAHouse2026Spending.html.
//
// Source: U.S. Census Bureau cartographic boundary files, 2024 (2021 Iowa redistricting plan,
// used for the 2022-2030 elections):
//   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_19_sldl_500k.zip
//   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip
//
// Prepare the projected GeoJSON inputs (NAD83 / UTM zone 15N) with mapshaper:
//   P="+proj=utm +zone=15 +datum=NAD83 +units=m"
//   npx mapshaper sldl/cb_2024_19_sldl_500k.shp -proj "$P" -simplify interval=100 keep-shapes -filter-fields NAME -o format=geojson precision=1 districts.json
//   npx mapshaper sldl/cb_2024_19_sldl_500k.shp -proj "$P" -points inner -filter-fields NAME -o format=geojson precision=1 labels.json
//   npx mapshaper sldl/cb_2024_19_sldl_500k.shp -proj "$P" -simplify interval=100 keep-shapes -dissolve -o format=geojson precision=1 state.json
//   npx mapshaper county/cb_2024_us_county_500k.shp -filter 'STATEFP=="19"' -proj "$P" -simplify interval=200 -innerlines -o format=geojson precision=1 counties.json
//   npx mapshaper cities.csv -points x=lon y=lat -proj from=wgs84 "$P" -o format=geojson precision=1 cities.json
//
// Usage: node tools/build-house-map.mjs <dir with the five .json files>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node tools/build-house-map.mjs <geojson dir>");
  process.exit(1);
}
const HTML = new URL("../midterm/IAHouse2026Spending.html", import.meta.url);
const BEGIN = "// MAP-DATA:BEGIN";
const END = "// MAP-DATA:END";
const WIDTH = 1000;
const PAD = 8;

const load = (name) => {
  const json = JSON.parse(readFileSync(join(dir, name), "utf8"));
  return json.features ?? json.geometries.map((geometry) => ({ geometry, properties: {} }));
};
const districts = load("districts.json");
const labels = load("labels.json");
const state = load("state.json");
const counties = load("counties.json");
const cities = load("cities.json");

const rings = (g) => g.type === "Polygon" ? g.coordinates
  : g.type === "MultiPolygon" ? g.coordinates.flat()
  : g.type === "LineString" ? [g.coordinates]
  : g.type === "MultiLineString" ? g.coordinates : [];

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of districts) for (const r of rings(f.geometry)) for (const [x, y] of r) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
const k = (WIDTH - PAD * 2) / (maxX - minX);
const HEIGHT = Math.ceil((maxY - minY) * k + PAD * 2);
const px = ([x, y]) => [Math.round(((x - minX) * k + PAD) * 10), Math.round(((maxY - y) * k + PAD) * 10)];
const fmt = (n) => (n / 10).toString().replace(/^(-?)0\./, "$1.");
const pair = (a, b) => `${fmt(a)}${b < 0 ? "" : " "}${fmt(b)}`;

// Relative commands from rounded absolute points so rounding error does not accumulate.
function path(geom, close) {
  let out = "";
  for (const ring of rings(geom)) {
    const pts = ring.map(px);
    let [lx, ly] = pts[0];
    out += `M${pair(lx, ly)}l`;
    const steps = [];
    for (const [x, y] of pts.slice(1, close ? -1 : undefined)) {
      if (x === lx && y === ly) continue;
      steps.push(pair(x - lx, y - ly));
      lx = x; ly = y;
    }
    out += steps.join(" ").replace(/ -/g, "-") + (close ? "z" : "");
  }
  return out;
}

const point = (f) => px(f.geometry.coordinates).map((n) => n / 10);
const byNum = (a, b) => Number(a.properties.NAME) - Number(b.properties.NAME);
const data = {
  w: WIDTH,
  h: HEIGHT,
  districts: Object.fromEntries([...districts].sort(byNum).map((f) => [f.properties.NAME, path(f.geometry, true)])),
  labels: Object.fromEntries([...labels].sort(byNum).map((f) => [f.properties.NAME, point(f)])),
  state: state.map((f) => path(f.geometry, true)).join(""),
  counties: counties.map((f) => path(f.geometry, false)).join(""),
  cities: cities.map((f) => [f.properties.name, ...point(f)]),
};
if (Object.keys(data.districts).length !== 100) throw new Error("Expected 100 districts");

const block = `${BEGIN}\n// Census Bureau 2024 cartographic boundaries; regenerate with tools/build-house-map.mjs\nconst MAP = ${JSON.stringify(data)};\n${END}`;
const html = readFileSync(HTML, "utf8");
const start = html.indexOf(BEGIN), stop = html.indexOf(END);
if (start < 0 || stop < 0) throw new Error(`Markers ${BEGIN} / ${END} not found in ${HTML.pathname}`);
writeFileSync(HTML, html.slice(0, start) + block + html.slice(stop + END.length));
console.log(`Wrote map data (${(block.length / 1024).toFixed(0)} KB, ${WIDTH}x${HEIGHT}) to ${HTML.pathname}`);
