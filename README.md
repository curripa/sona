<h1 align="center">SONA</h1>

<p align="center"><a href="README.es.md">Español</a> · English</p>

**Sona** is a standalone music player for the [curripa.github.io](https://curripa.github.io) catalog. A static, single-page app that presents every album in a browsable, filterable grid with a persistent bottom player.

## Features

- **Album grid with detail panel**: responsive grid of album covers; clicking an album opens a sticky detail panel with cover, track list, and play-all.
- **Built-in player bar**: fixed bottom bar with cover, track/album/band info, previous/play/next, shuffle and repeat (off/all/one), seekable progress bar, keyboard shortcuts (arrows/Home/End) and Media Session integration.
- **Search and filters**: full-text search by album or band, filter by genre (metal/punk/alternative/other) and by band, sort by date or name (asc/desc), collapsible filter group on mobile.
- **Shuffle mix**: generates a randomized ~1-hour playlist from the currently visible albums.
- **Favorites**: mark tracks as favorites (persisted in `localStorage`), filter to show only albums with favorites and a favorites counter.
- **Lyrics**: expandable lyrics panel per track when available.
- **Bilingual (es/en)**: language detected from the browser (Spanish by default), persisted in `localStorage`.
- **Dark theme**: dark-only design with `Bebas Neue` (headings) and `JetBrains Mono` (body).
- **Static and lightweight**: rendered as static HTML at build time; audio and covers are streamed from `curripa.github.io`; no backend.

## Stack

- [Astro](https://astro.build) (static site generation)
- [Tailwind CSS](https://tailwindcss.com)
- Fonts: *Bebas Neue* (headings) and *JetBrains Mono* (body)
- Deployed to **GitHub Pages** via GitHub Actions

## Project structure

```
.
├── .github/workflows/deploy.yml   # CI/CD: build + deploy to Pages
├── astro.config.mjs               # Astro config (site + base for /sona/)
├── tailwind.config.cjs
├── package.json
├── scripts/
│   ├── fetch-curripa.mjs          # Scraper → catalog JSON from curripa.github.io
│   └── smoke-test.mjs             # Smoke test (build artifact checks)
├── src/
│   ├── components/
│   │   └── PlayerBar.astro        # Fixed bottom player bar
│   ├── data/
│   │   ├── config.json            # curripaOrigin, siteName, siteDescription
│   │   └── generated/catalog.json # Catalog scraped from curripa.github.io (do not edit)
│   ├── i18n/
│   │   ├── dict.js                # es/en dictionary
│   │   ├── init.js                # i18n DOM binding
│   │   └── language.js            # language detection + persistence
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── app.ts                 # Grid, filters, detail panel, player wiring
│   │   ├── player.ts              # Audio queue, play/pause/next/prev/repeat
│   │   ├── search.ts              # Search helpers
│   │   ├── storage.ts             # localStorage helpers
│   │   └── types.ts               # Catalog, Band, Album, Track types
│   ├── pages/index.astro          # Single page (grid + panel)
│   └── styles/global.css
```

## Getting started

Requirements: **Node.js 20+**.

```bash
npm install
npm run dev        # dev server at http://localhost:4321/sona/
npm run build      # builds the site into dist/
npm run preview    # serves the build locally
```

### Catalog

The catalog is not maintained by hand: it is scraped from the public HTML of `curripa.github.io`. The source URL is configured in `src/data/config.json` (`curripaOrigin`); the script scrapes band sections, discography cards, and track metadata (including audio URLs and lyrics) and writes the result to `src/data/generated/catalog.json`.

```bash
npm run fetch      # refreshes src/data/generated/catalog.json from curripaOrigin
```

`src/data/generated/catalog.json` is generated and should not be edited by hand. If the fetch fails, the existing snapshot is preserved. The deployed site at `https://curripa.github.io/sona/` streams audio and cover art directly from `https://curripa.github.io/audio/` and `/img/covers/`.

## Internationalization

The site is rendered in Spanish and switches to English based on the browser language. Strings live in `src/i18n/dict.js`:

- `data-i18n` → replaces text content.
- `data-i18n-aria` → replaces the `aria-label` attribute.
- `data-i18n-placeholder` → replaces the `placeholder` attribute.
- Persistence via `localStorage` (`sona.lang`) and a `langchange` event for re-rendering.

## Deployment

The `.github/workflows/deploy.yml` workflow handles everything on every push to `main` (and can be triggered manually via *Actions*):

1. Installs dependencies.
2. Builds the site (`astro build`).
3. Publishes `dist/` to **GitHub Pages**.

To enable it in a repository:

1. Push the project to GitHub.
2. In *Settings → Pages*, select **GitHub Actions** as the deployment source.
3. The workflow will deploy the site to `https://<user>.github.io/sona/`.

The site URL and base path are configured in `astro.config.mjs` (`site` + `base`).
