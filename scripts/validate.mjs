// Checks the data files for broken links between files and common content mistakes.
import { readFileSync } from 'node:fs';
const load = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const tax = load('taxonomy.json'), places = load('places.json'), events = load('events.json'), qs = load('questions.json');
const errs = [];
const placeIds = new Set(places.map(p => p.id)), eventIds = new Set(events.map(e => e.id));
const eras = new Set(tax.eras.map(e => e.id)), regions = new Set(tax.regions.map(r => r.id)), topics = new Set(tax.topics);
for (const p of places) if (!regions.has(p.region)) errs.push(`place ${p.id}: unknown region ${p.region}`);
for (const e of events) {
  if (!placeIds.has(e.placeId)) errs.push(`event ${e.id}: unknown place`);
  if (!eras.has(e.era)) errs.push(`event ${e.id}: unknown era`);
  e.topics.forEach(t => topics.has(t) || errs.push(`event ${e.id}: unknown topic ${t}`));
  if (!e.summary['6-12'] || !e.summary.adult) errs.push(`event ${e.id}: missing summary`);
  if (!e.sources?.length) errs.push(`event ${e.id}: no sources`);
  if (e.year > new Date().getFullYear() - 15) errs.push(`event ${e.id}: newer than 15 years`);
}
for (const q of qs) {
  if (!eventIds.has(q.eventId)) errs.push(`question ${q.id}: unknown event`);
  if (q.choices.filter(c => c.correct).length !== 1) errs.push(`question ${q.id}: needs exactly one correct`);
  q.choices.filter(c => !c.correct && !c.why).forEach(c => errs.push(`question ${q.id}: choice ${c.id} lacks why`));
  q.bands.forEach(b => { if (!q.prompt[b] && !q.prompt['6-12']) errs.push(`question ${q.id}: no prompt for ${b}`); });
}
const all = JSON.stringify([places, events, qs]);
if (/—/.test(all)) errs.push('em dash found in content');
const us = places.filter(p => p.country === 'United States').length;
console.log(`places ${places.length}, events ${events.length}, questions ${qs.length}`);
console.log(`US ${us} / world ${places.length - us}; Plains ${places.filter(p => p.plains).length}`);
console.log(`types: ${qs.filter(q=>q.type==='event-to-place').length} event-to-place, ${qs.filter(q=>q.type==='place-to-event').length} place-to-event`);
console.log(errs.length ? errs.join('\n') : 'No problems found.');
process.exit(errs.length ? 1 : 0);
