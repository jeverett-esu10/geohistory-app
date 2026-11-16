// Builds preview/index.html, a readable review page generated from the data files.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoEqualEarth, geoPath, geoGraticule10 } from 'd3-geo';
import { feature } from 'topojson-client';
const root = new URL('..', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const data = {
  taxonomy: JSON.parse(read('data/taxonomy.json')),
  places: JSON.parse(read('data/places.json')),
  events: JSON.parse(read('data/events.json')),
  questions: JSON.parse(read('data/questions.json')),
};
const topo = JSON.parse(read('node_modules/world-atlas/land-110m.json'));
const land = feature(topo, topo.objects.land);
const W = 960, H = 470;
const proj = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
const path = geoPath(proj).digits(1);
const pins = data.events.map((e, i) => {
  const p = data.places.find(pl => pl.id === e.placeId);
  const [x, y] = proj([p.lng, p.lat]);
  return { n: i + 1, id: e.id, x: +x.toFixed(1), y: +y.toFixed(1), us: p.country === 'United States', plains: p.plains, label: `${p.name}, ${p.country === 'United States' ? p.admin : p.country}` };
});
// Nudge pins that overlap so every number stays visible; a leader line points to the true spot.
const R = 13;
for (let i = 0; i < pins.length; i++) {
  const p = pins[i]; p.lx = p.x; p.ly = p.y;
  for (let tries = 0; tries < 12 && pins.slice(0, i).some(q => Math.hypot(q.lx - p.lx, q.ly - p.ly) < R * 2.1); tries++) {
    const a = -Math.PI / 4 + tries * 0.9; p.lx = +(p.x + Math.cos(a) * R * 2.6).toFixed(1); p.ly = +(p.y + Math.sin(a) * R * 2.6).toFixed(1);
  }
}
const map = { R, W, H, sphere: path({ type: 'Sphere' }), grat: path(geoGraticule10()), land: path(land), pins };
const tpl = read('scripts/preview-template.html');
const out = tpl.replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'))
               .replace('/*__MAP__*/null', JSON.stringify(map));
writeFileSync(new URL('preview/index.html', root), out);
console.log(`Wrote preview/index.html (${(out.length / 1024).toFixed(0)} KB)`);
