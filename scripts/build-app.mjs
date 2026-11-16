// Builds the prototype two ways:
//   dist/                     GitHub Pages site (offline support, self-hosted fonts, installable)
//   dist-artifact/index.html  single file for publishing as a Claude Artifact
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { buildMaps } from './maps.mjs';
const root = new URL('..', import.meta.url);
const rel = p => new URL(p, root);
const read = p => readFileSync(rel(p), 'utf8');
const json = p => JSON.parse(read(p));
const pkg = json('package.json');

const places = json('data/places.json');
const base = {
  taxonomy: json('data/taxonomy.json'), places, events: json('data/events.json'), questions: json('data/questions.json'),
  maps: buildMaps(places),
};
const config = { launchDate: '2026-11-09', version: pkg.version };
const dataJS = cfg => `window.GHF=${JSON.stringify({ ...base, config: { ...config, ...cfg } }).replace(/</g, '\\u003c')};`;
const css = read('app/styles.css'), appJS = read('app/app.js');
const fonts = [
  ['Atkinson Hyperlegible', 400, '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2'],
  ['Atkinson Hyperlegible', 700, '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2'],
  ['Bricolage Grotesque', 700, '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2'],
  ['Bricolage Grotesque', 800, '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2'],
];
const body = `<a class="skip" href="#main">Skip to content</a>
<header class="top" id="top"></header>
<main id="main" tabindex="-1"></main>
<nav class="tabbar" id="tabbar" aria-label="Main"></nav>
<noscript><p style="padding:16px">GeoHistory Fun! needs JavaScript turned on.</p></noscript>`;

// ---- GitHub Pages build ----
rmSync(rel('dist'), { recursive: true, force: true });
mkdirSync(rel('dist/fonts'), { recursive: true });
const fontFiles = fonts.map(([, , f]) => 'fonts/' + f.split('/').pop());
fonts.forEach(([, , f], i) => copyFileSync(rel('node_modules/' + f), rel('dist/' + fontFiles[i])));
writeFileSync(rel('dist/fonts.css'), fonts.map(([fam, w], i) => `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:swap;src:url(${fontFiles[i]}) format("woff2")}`).join('\n'));
writeFileSync(rel('dist/styles.css'), css);
writeFileSync(rel('dist/app.js'), appJS);
writeFileSync(rel('dist/data.js'), dataJS({ offline: true }));
for (const f of ['icon.svg', 'icon-192.png', 'icon-512.png']) copyFileSync(rel('app/' + f), rel('dist/' + f));
writeFileSync(rel('dist/.nojekyll'), '');
writeFileSync(rel('dist/sw.js'), read('app/sw.js').replace('__VERSION__', `ghf-${pkg.version}-${Date.now()}`).replace('__FONTS__', fontFiles.map(f => `'${f}'`).join(', ')));
writeFileSync(rel('dist/manifest.webmanifest'), JSON.stringify({
  name: 'GeoHistory Fun!', short_name: 'GeoHistory', description: 'A daily dose of geography and history.',
  start_url: './#today', scope: './', display: 'standalone', background_color: '#F3F6FB', theme_color: '#14213D',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }]
}, null, 2));
writeFileSync(rel('dist/index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>GeoHistory Fun!</title>
<meta name="description" content="A daily dose of geography and history: one place a day, plus a quiz that adapts to you.">
<meta name="theme-color" content="#14213D">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<link rel="stylesheet" href="fonts.css">
<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
<script src="data.js"></script>
<script src="app.js"></script>
</body>
</html>
`);

// ---- Single-file Artifact build ----
mkdirSync(rel('dist-artifact'), { recursive: true });
writeFileSync(rel('dist-artifact/index.html'), `<title>GeoHistory Fun!</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap">
<style>${css}</style>
${body}
<script>${dataJS({ offline: false })}</script>
<script>${appJS}</script>
`);
console.log('Built dist/ and dist-artifact/index.html');
