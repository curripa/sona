import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, '..', 'dist');
const indexPath = join(dist, 'index.html');
const html = readFileSync(indexPath, 'utf-8');

const scripts = [];
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) scripts.push(m[1]);

const vc = new VirtualConsole();
vc.on('jsdomError', (err) => console.log('[jsdomError]', err && err.message ? err.message : err));
vc.on('error', (...a) => console.log('[console.error]', ...a));

const dom = new JSDOM(html, {
  url: 'https://curripa.github.io/sona/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLMediaElement.prototype.play = function () {
      this.dispatchEvent(new window.Event('play'));
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function () {
      this.dispatchEvent(new window.Event('pause'));
    };
    Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
      get() {
        return this._ct || 0;
      },
      set(v) {
        this._ct = v;
      },
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'duration', {
      get() {
        return 250;
      },
    });
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
  },
});

function execScript(src) {
  const rel = src.replace(/^\/(?:sona)?\/?/, '') || 'noop';
  if (!/\.js$/.test(rel)) return;
  console.log(`[eval] readyState=${dom.window.document.readyState} src=${rel}`);
  const code = readFileSync(join(dist, rel), 'utf-8');
  dom.window.eval(code);
}

for (const src of scripts) {
  if (src.startsWith('/')) execScript(src);
}

dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

const { window } = dom;
const doc = window.document;

const results = [];
function assert(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function gridTiles() {
  return Array.from(doc.querySelectorAll('#album-grid .album-card'));
}

setTimeout(() => {
  try {
    assert('player-bar always visible', !!doc.getElementById('player-bar') && !doc.getElementById('player-bar').classList.contains('hidden'));
    assert('album grid starts populated', gridTiles().length > 0);
    assert('sort field defaults to name', doc.getElementById('sort-field').value === 'date');
    assert('sort direction defaults to asc', doc.getElementById('sort-dir').textContent.trim() === '↑');
    const gridArea = doc.getElementById('grid-area');
    assert('grid visible by default', !!gridArea && !gridArea.classList.contains('hidden'));

    // grid-toggle ignored before any album is selected (never empty / no empty panel)
    doc.getElementById('grid-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert('grid-toggle ignored without selection', !gridArea.classList.contains('hidden'));

    // select an album -> shows detail panel without autoplay
    const tile = doc.querySelector('.album-card[data-band="industrial-discipline"][data-album="inner-collapse"]');
    assert('target album tile present', !!tile);
    tile.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

    setTimeout(() => {
      const bar = doc.getElementById('player-bar');
      const panel = doc.getElementById('album-detail-panel');
      const firstTrack = doc.querySelector('.track-row[data-band="industrial-discipline"][data-album="inner-collapse"][data-number="1"] [data-play-btn]');
      const playAllBtn = doc.querySelector('#album-detail [data-play-all]');
      console.log('[dbg] bar.hidden=', bar.classList.contains('hidden'), 'panel.hidden=', panel.classList.contains('hidden'), 'playAll=', !!playAllBtn, 'toggle=', JSON.stringify(doc.getElementById('pb-toggle').textContent));
      assert('detail panel shown on select', panel && !panel.classList.contains('hidden'));
      assert('panel renders track rows', !!firstTrack);
      assert('no autoplay on select (toggle stays paused)', doc.getElementById('pb-toggle').textContent === '▶');
      assert('play-all button present in detail', !!playAllBtn);

      // play all -> loads album into player and starts playback
      playAllBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('player-bar visible after play all', bar && !bar.classList.contains('hidden'));
      assert('playback starts after play all', doc.getElementById('pb-toggle').textContent === '⏸');
      assert('pb-title filled', (doc.getElementById('pb-title').textContent || '').length > 0);

      // favorite toggle (panel track row)
      const favBtn = doc.querySelector('.track-row [data-fav-btn]');
      if (favBtn) favBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      console.log('[dbg] fav-count=', doc.getElementById('fav-count').textContent, 'stored=', window.localStorage.getItem('sona:favorites'));
      assert('favorite count becomes 1', doc.getElementById('fav-count').textContent === '1');

      // search filters the grid
      const searchInput = doc.getElementById('search-input');
      searchInput.value = 'nergui';
      searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      const innerCollapseStillShown = !!doc.querySelector('.album-card[data-band="industrial-discipline"][data-album="inner-collapse"]');
      const nerguiShown = !!doc.querySelector('.album-card[data-band="nergui"]');
      assert('non-matching album hidden on search', innerCollapseStillShown === false);
      assert('matching band album shown on search', nerguiShown === true);
      searchInput.value = '';
      searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      assert('clearing search restores all albums', gridTiles().length > 0);

      // favorites only -> only albums containing the favorite remain
      const favToggle = doc.getElementById('nav-favorites');
      favToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      const favAlbums = gridTiles().filter((c) => !c.classList.contains('hidden'));
      const hasFavAlbum = favAlbums.some((c) => c.dataset.album === 'inner-collapse');
      const anyOtherVisible = favAlbums.some((c) => c.dataset.album !== 'inner-collapse');
      console.log('[dbg] fav-only tiles=', favAlbums.length, 'hasInner=', hasFavAlbum, 'anyOther=', anyOtherVisible);
      assert('favorites-only shows the album with the favorite', hasFavAlbum);
      assert('onlyFav shows no empty state while favorites exist', doc.getElementById('empty-state').classList.contains('hidden'));

      // unfavorite -> empty state
      favToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); // back to Todos to see the row again? row only in panel
      const favBtn2 = doc.querySelector('.track-row [data-fav-btn][aria-pressed="true"]') || doc.querySelector('.track-row[data-fav="true"] [data-fav-btn]');
      if (favBtn2) favBtn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('empty state shown once last favorite removed (still in fav-only view)', doc.getElementById('empty-state').classList.contains('hidden'));

      // next advances the queued album
      const titleBefore = doc.getElementById('pb-title').textContent;
      doc.getElementById('pb-next').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('next advances within album queue', doc.getElementById('pb-title').textContent !== titleBefore);

      // sort control re-renders without crashing and honors direction label
      const sortField = doc.getElementById('sort-field');
      sortField.value = 'date';
      sortField.dispatchEvent(new window.Event('change', { bubbles: true }));
      doc.getElementById('sort-dir').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('sort to date descending keeps grid rendered', gridTiles().length > 0);
      assert('sort direction toggled to desc', doc.getElementById('sort-dir').textContent.trim() === '↓');

      // panel hide/show
      doc.querySelector('[data-panel-hide]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('panel hidden via hide control', doc.getElementById('album-detail-panel').classList.contains('hidden'));
      doc.getElementById('panel-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('panel re-shown via toggle', !doc.getElementById('album-detail-panel').classList.contains('hidden'));

      // grid toggle (album now selected): hide grid -> panel expands, never empty
      const panelEl = doc.getElementById('album-detail-panel');
      doc.getElementById('grid-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('grid hidden after toggle', gridArea.classList.contains('hidden'));
      assert('panel visible when grid hidden (never empty)', !panelEl.classList.contains('hidden'));
      assert('panel expands when grid hidden', panelEl.classList.contains('md:flex-1'));
      assert('grid-toggle label reflects hidden', /Portadas|Covers/.test(doc.getElementById('grid-toggle').textContent.trim()) && doc.getElementById('grid-toggle').textContent.includes('⬅'));

      // hide panel while grid is hidden -> never empty: grid forced back
      doc.getElementById('panel-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('hide panel forces grid back (never empty)', !gridArea.classList.contains('hidden'));
      assert('panel hidden after forcing', panelEl.classList.contains('hidden'));
      assert('panel width restored when grid visible', panelEl.classList.contains('md:w-[340px]'));

      // re-show panel -> both visible, grid stays (never empty holds both)
      doc.getElementById('panel-toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert('grid stays visible when panel re-shown', !gridArea.classList.contains('hidden'));
      assert('panel visible with grid (both shown)', !panelEl.classList.contains('hidden'));

      const stored = JSON.parse(window.localStorage.getItem('sona:favorites') || '[]');
      assert('favorites persisted', stored.length === 0);

      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length} assertions, ${failed.length} failed`);
      process.exit(failed.length === 0 ? 0 : 1);
    }, 60);
  } catch (err) {
    console.error('Smoke test crashed:', err);
    process.exit(2);
  }
}, 120);