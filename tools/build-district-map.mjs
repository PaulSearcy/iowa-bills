#!/usr/bin/env node
// Embed Iowa map boundaries as SVG paths in a midterm page: legislative districts for the Iowa
// House and Senate pages, counties for the U.S. Senate and U.S. House pages.
//
// Source: U.S. Census Bureau cartographic boundary files, 2024 (2021 Iowa redistricting plan,
// used for the 2022-2030 elections). House is the lower chamber (sldl), Senate the upper (sldu):
//   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_19_sldl_500k.zip
//   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_19_sldu_500k.zip
//   https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip
//
// Prepare the projected GeoJSON inputs (NAD83 / UTM zone 15N) with mapshaper.
// For house/senate, SHP is sldl/cb_2024_19_sldl_500k.shp or sldu/cb_2024_19_sldu_500k.shp:
//   P="+proj=utm +zone=15 +datum=NAD83 +units=m"
//   npx mapshaper $SHP -proj "$P" -simplify interval=100 keep-shapes -filter-fields NAME -o format=geojson precision=1 districts.json
//   npx mapshaper $SHP -proj "$P" -points inner -filter-fields NAME -o format=geojson precision=1 labels.json
//   npx mapshaper $SHP -proj "$P" -simplify interval=100 keep-shapes -dissolve -o format=geojson precision=1 state.json
//   npx mapshaper county/cb_2024_us_county_500k.shp -filter 'STATEFP=="19"' -proj "$P" -simplify interval=200 -innerlines -o format=geojson precision=1 counties.json
//   npx mapshaper cities.csv -points x=lon y=lat -proj from=wgs84 "$P" -o format=geojson precision=1 cities.json
// For ussenate/ushouse, run the same districts/labels/state commands with
// SHP="county/cb_2024_us_county_500k.shp -filter 'STATEFP==\"19\"'" (counties.json is not used), plus cities.json.
// ushouse also needs the congressional districts. Iowa's districts follow county lines, so they are
// built by dissolving counties, using cd.csv (columns NAME,CD) from the county rows of the SOS results:
//   npx mapshaper $SHP -proj "$P" -simplify interval=100 keep-shapes -filter-fields NAME -join cd.csv keys=NAME,NAME string-fields=NAME -dissolve CD -o format=geojson precision=1 cds.json
//   npx mapshaper cds.json -points inner -o format=geojson precision=1 cdlabels.json
//
// Usage: node tools/build-district-map.mjs <house|senate|ussenate|ushouse> <geojson dir>

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHAMBERS = {
  house: { page: "IAHouse2026Spending.html", count: 100 },
  senate: { page: "IASenate2026Spending.html", count: 50 },
  ussenate: { page: "IAUSSenate2026Spending.html", count: 99, byCounty: true },
  ushouse: { page: "IAUSHouse2026Spending.html", count: 99, byCounty: true, cds: true },
};
const [chamberName, dir] = process.argv.slice(2);
const chamber = CHAMBERS[chamberName];
if (!chamber || !dir) {
  console.error(`Usage: node tools/build-district-map.mjs <${Object.keys(CHAMBERS).join("|")}> <geojson dir>`);
  process.exit(1);
}
const HTML = new URL(`../midterm/${chamber.page}`, import.meta.url);
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
const byName = (a, b) => a.properties.NAME.localeCompare(b.properties.NAME);
const keyed = (features, key, value) => Object.fromEntries(features.map((f) => [f.properties[key], value(f)]));
const statePath = state.map((f) => path(f.geometry, true)).join("");
const cityPoints = cities.map((f) => [f.properties.name, ...point(f)]);
const data = chamber.byCounty
  ? {
    w: WIDTH,
    h: HEIGHT,
    counties: keyed([...districts].sort(byName), "NAME", (f) => path(f.geometry, true)),
    labels: keyed([...labels].sort(byName), "NAME", point),
    ...(chamber.cds && {
      districts: keyed(load("cds.json"), "CD", (f) => path(f.geometry, true)),
      districtLabels: keyed(load("cdlabels.json"), "CD", point),
    }),
    state: statePath,
    cities: cityPoints,
  }
  : {
    w: WIDTH,
    h: HEIGHT,
    districts: keyed([...districts].sort(byNum), "NAME", (f) => path(f.geometry, true)),
    labels: keyed([...labels].sort(byNum), "NAME", point),
    state: statePath,
    counties: load("counties.json").map((f) => path(f.geometry, false)).join(""),
    cities: cityPoints,
  };
const shapes = chamber.byCounty ? data.counties : data.districts;
if (Object.keys(shapes).length !== chamber.count) throw new Error(`Expected ${chamber.count} shapes`);
if (chamber.cds && Object.keys(data.districts).length !== 4) throw new Error("Expected 4 congressional districts");

const block = `${BEGIN}\n// Census Bureau 2024 cartographic boundaries; regenerate with tools/build-district-map.mjs ${chamberName}\nconst MAP = ${JSON.stringify(data)};\n${END}`;
const html = readFileSync(HTML, "utf8");
const start = html.indexOf(BEGIN), stop = html.indexOf(END);
if (start < 0 || stop < 0) throw new Error(`Markers ${BEGIN} / ${END} not found in ${HTML.pathname}`);
writeFileSync(HTML, html.slice(0, start) + block + html.slice(stop + END.length));
console.log(`Wrote map data (${(block.length / 1024).toFixed(0)} KB, ${WIDTH}x${HEIGHT}) to ${HTML.pathname}`);
