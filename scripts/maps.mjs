// Precomputes SVG path data for the world map and a zoomed locator map for each place.
import { readFileSync } from 'node:fs';
import { geoEqualEarth, geoOrthographic, geoPath, geoGraticule10, geoCentroid } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
const read = p => JSON.parse(readFileSync(new URL(`../node_modules/${p}`, import.meta.url), 'utf8'));

export function buildMaps(places) {
  const world = read('world-atlas/countries-50m.json');
  const world110 = read('world-atlas/land-110m.json');
  const states = read('us-atlas/states-10m.json');
  const land110 = feature(world110, world110.objects.land);
  const land50 = feature(world, world.objects.land);
  const countries = feature(world, world.objects.countries).features;
  const countryBorders = mesh(world, world.objects.countries, (a, b) => a !== b);
  const stateFeatures = feature(states, states.objects.states).features;
  const stateBorders = mesh(states, states.objects.states, (a, b) => a !== b);

  // World overview
  const W = 960, H = 470;
  const proj = geoEqualEarth().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
  const p = geoPath(proj).digits(1);
  const overview = { W, H, sphere: p({ type: 'Sphere' }), grat: p(geoGraticule10()), land: p(land110), pins: {} };
  for (const pl of places) overview.pins[pl.id] = proj([pl.lng, pl.lat]).map(v => +v.toFixed(1));

  // Locators: orthographic view centered on each place
  const LW = 480, LH = 320;
  const locators = {};
  for (const pl of places) {
    const us = pl.country === 'United States';
    const o = geoOrthographic().rotate([-pl.lng, -pl.lat]).translate([LW / 2, LH / 2])
      .scale(us ? 900 : 700).clipAngle(90).clipExtent([[0, 0], [LW, LH]]);
    const lp = geoPath(o).digits(0);
    const hl = us
      ? stateFeatures.find(f => f.properties.name === pl.admin)
      : countries.find(f => f.properties.name === pl.country);
    locators[pl.id] = {
      W: LW, H: LH,
      grat: lp(geoGraticule10()),
      land: lp(land50),
      borders: lp(countryBorders) + (us ? lp(stateBorders) : ''),
      highlight: hl ? lp(hl) : '',
      highlightName: hl ? (us ? pl.admin : pl.country) : null,
      pin: o([pl.lng, pl.lat]).map(v => +v.toFixed(1)),
    };
  }
  return { overview, locators };
}
