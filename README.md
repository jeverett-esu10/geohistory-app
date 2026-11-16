# GeoHistory Fun!

A daily geography and history app: one Place of the Day, a 5-question adaptive quiz, and a practice mode.
Prototype v0.1. Personal use, no accounts, progress saved only in the browser.

## What's here
| Path | What it is |
|---|---|
| `data/` | All content: `taxonomy.json`, `places.json`, `events.json`, `questions.json`. Edit these to add places and questions. |
| `app/` | The app: `app.js`, `styles.css`, `sw.js` (offline support), icons |
| `scripts/validate.mjs` | Checks the content files for mistakes |
| `scripts/build-app.mjs` | Builds `dist/` (website) and `dist-artifact/index.html` (single-file version) |
| `scripts/build-preview.mjs` | Builds the content review page in `preview/` |
| `.github/workflows/pages.yml` | Publishes `dist/` to GitHub Pages on every push to `main` |

## Build and run locally
```bash
npm install
node scripts/validate.mjs
node scripts/build-app.mjs
cd dist && python3 -m http.server 8000
```
Then open http://localhost:8000.

## Publish on GitHub Pages
1. Push this folder to a GitHub repository (branch `main`).
2. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
3. The workflow builds and publishes the site. The address appears under the workflow run and in Settings > Pages.

## How it works
- **Place of the Day:** picked from the date, so everyone in the same grade band sees the same place. First day: `2026-11-09` (`config.launchDate` in `scripts/build-app.mjs`).
- **Daily quiz:** 1 question about today's place, up to 2 review questions that are due, and new questions. New questions lean toward weak areas and toward Nebraska and the Plains, based on the user's setting.
- **Review boxes:** a correct answer moves a question up a box (review again in 1, 2, 4, 8, or 16 days). A miss sends it back to box 1.
- **Scoring:** 10 points per correct answer, +5 for hard questions, +3 time bonus if turned on. Daily streak with one automatic freeze each week.
- **Privacy:** no accounts, analytics, or outside requests. Fonts and maps are bundled with the app.

## Credits
Map data: Natural Earth and US Census (via world-atlas and us-atlas), public domain.
Fonts: Atkinson Hyperlegible and Bricolage Grotesque, SIL Open Font License.
