// Renders icon.svg to PNG app icons using the preinstalled Playwright browser.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../app/icon.svg'), 'utf8'); const b = await chromium.launch();
  for (const s of [192, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<style>html,body{margin:0;background:#14213D}</style><div style="width:${s}px;height:${s}px;display:grid;place-items:center">${svg.replace('<svg ', `<svg width="${Math.round(s*0.86)}" height="${Math.round(s*0.86)}" `)}</div>`);
    await p.screenshot({ path: path.join(__dirname, `../app/icon-${s}.png`) });
  }
  await b.close();
})();
