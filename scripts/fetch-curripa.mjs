import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as loadCheerio } from 'cheerio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputPath = join(__dirname, '..', 'src', 'data', 'generated', 'catalog.json');

const { curripaOrigin } = JSON.parse(
  readFileSync(join(__dirname, '..', 'src', 'data', 'config.json'), 'utf-8')
);
const SITE_URL = curripaOrigin.replace(/\/+$/, '');

const toAbsolute = (url) => {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  return SITE_URL + '/' + url.replace(/^\/+/, '');
};

const decodeEntities = (value) => {
  if (!value) return '';
  const map = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => map[m] ?? m);
};

const parseDuration = (text) => {
  const m = `${text || ''}`.trim().match(/^(\d+):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

const preserveExistingSnapshot = (message) => {
  if (existsSync(outputPath)) {
    console.warn(message);
    console.warn(`  → Preserved existing snapshot at ${outputPath}`);
    return true;
  }
  console.warn('  → No existing snapshot to preserve');
  return false;
};

try {
  console.log(`Fetching ${SITE_URL} ...`);
  const response = await fetch(SITE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const $ = loadCheerio(html);

  const bands = [];

  $('section[data-band-section]').each((_, el) => {
    const section = $(el);
    const bandId = section.attr('id') || '';

    const logoEl = section.find('img[src^="/SVG/"]').first();
    const bandName = logoEl.attr('alt') || bandId;
    const logoRaw = logoEl.attr('src') || '';
    const logoUrl = logoRaw.endsWith('-negro.svg')
      ? logoRaw.replace('-negro.svg', '.svg')
      : logoRaw;

    const yearsActive = section
      .find('> div > p')
      .first()
      .text()
      .trim();

    const band = {
      id: bandId,
      name: bandName,
      yearsActive,
      logoUrl: toAbsolute(logoUrl),
      history: section.find('[data-band-history] span[data-lang="es"]').first().text().trim() || null,
      historyEn: section.find('[data-band-history] span[data-lang="en"]').first().text().trim() || null,
      albums: [],
    };

    section.find('.discography-view button.album-card').each((_, cardEl) => {
      const card = $(cardEl);
      const albumId = card.attr('data-album-id') || '';

      const yearText = card.find('p.text-xs').first().text().trim();
      const album = {
        albumId,
        title: decodeEntities(card.attr('data-album-title') || ''),
        year: parseInt(yearText, 10) || null,
        releaseDate: null,
        coverUrl: toAbsolute(card.attr('data-album-cover')),
        bandcampUrl: card.attr('data-album-url') || null,
        tracks: [],
      };

      const detail = section.find(`.album-detail[data-album-detail="${albumId}"]`);
      if (detail.length) {
        const dateText = detail.find('div.mb-4 p').first().text().trim();
        const m = dateText.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) album.releaseDate = `${m[3]}-${m[2]}-${m[1]}`;

        detail.find('.track-item').each((_, trackEl) => {
          const track = $(trackEl);
          const numberText = track.find('.tabular-nums').first().text().trim();
          const lyrics = track.find('div.track-lyrics').text().trim() || null;
          const audioUrl = toAbsolute(track.find('.track-play-btn').attr('data-audio-url'));
          const title = decodeEntities(track.find('[data-track-title]').text().trim());

          if (audioUrl) {
            album.tracks.push({
              number: parseInt(numberText, 10) || album.tracks.length + 1,
              title,
              duration: parseDuration(track.find('span.justify-self-end').text()),
              lyrics,
              audioUrl,
            });
          }
        });
      }

      band.albums.push(album);
    });

    bands.push(band);
  });

  if (bands.length === 0) {
    throw new Error('No band sections found — DOM parse produced an empty catalog');
  }

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: SITE_URL,
    bands,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n');

  const albumCount = bands.reduce((n, b) => n + b.albums.length, 0);
  const trackCount = bands.reduce(
    (n, b) => n + b.albums.reduce((m, a) => m + a.tracks.length, 0),
    0
  );
  console.log(`  → ${bands.length} bands, ${albumCount} albums, ${trackCount} tracks`);
  console.log(`  → Snapshot written to ${outputPath}`);
} catch (err) {
  console.error(`✗ Failed: ${err.message}`);
  preserveExistingSnapshot('Fetch failed; preserving existing snapshot.');
  process.exit(1);
}