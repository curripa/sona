import { readJSON, writeJSON, KEYS } from './storage';
import { findTrack, type Catalog, type TrackRef, type Band, type Album } from './types';
import {
  subscribe,
  playQueue,
  setQueueOnly,
  togglePlay,
  next,
  prev,
  seek,
  seekToPosition,
  getState,
  getRepeatMode,
  cycleRepeat,
  type PlayerState,
  type RepeatMode,
} from './player';
import { dict, DEFAULT_LANG } from '../i18n/dict.js';
import { getLang } from '../i18n/language.js';

interface PersistedPlayer {
  ref: TrackRef | null;
  queue: TrackRef[];
  index: number;
  position: number;
}

interface AlbumItem {
  band: Band;
  album: Album;
}

const SHUFFLE_ID = '__shuffle__';
const SHUFFLE_DURATION_TARGET = 3600;
const SHUFFLE_FALLBACK_DURATION = 180;
let shuffleVirtual: { band: Band; album: Album } | null = null;
let shuffleOrigin: Map<number, { band: Band; album: Album }> = new Map();

function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  const strings = dict[lang] ?? dict[DEFAULT_LANG];
  const fallback = dict[DEFAULT_LANG][key as keyof typeof dict.es] ?? key;
  const raw = (strings as Record<string, string>)[key] ?? fallback;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  const lang = getLang();
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return lang === 'en' ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
  }
}

function getEmptyCover(): string {
  const label = t('detail.no_cover');
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#1c1c24"/><text x="50%" y="50%" font-family="sans-serif" font-size="18" fill="#71717a" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
    )
  );
}

let emptyCover = getEmptyCover();

let catalog: Catalog = { generatedAt: '', source: '', bands: [] };
let favorites: Set<string> = new Set();
let mainEl: HTMLElement;
let searchInput: HTMLInputElement;
let favToggleBtn: HTMLButtonElement;
let query = '';
let filterBand = '';
let filterGenre = '';
let bandGenres: Map<string, { genre: string; styleEs: string; styleEn: string }> = new Map();
let gridVisible = true;
let panelVisible = false;
let albumSelected = false;
let selectedRef: { bandId: string; albumId: string } | null = null;
let lastExpanded = false;
let sortField: 'name' | 'date' = 'date';
let sortDir: 'asc' | 'desc' = 'asc';

const favKey = (ref: TrackRef): string => `${ref.bandId}/${ref.albumId}/${ref.number}`;

type TrackRow = HTMLElement;

function trRef(row: HTMLElement): TrackRef | null {
  const bandId = row.dataset.band;
  const albumId = row.dataset.album;
  const number = row.dataset.number ? parseInt(row.dataset.number, 10) : NaN;
  if (!bandId || !albumId || Number.isNaN(number)) return null;
  return { bandId, albumId, number };
}

function trackRow(ref: TrackRef): TrackRow | null {
  return mainEl.querySelector<HTMLElement>(
    `.track-row[data-band="${ref.bandId}"][data-album="${ref.albumId}"][data-number="${ref.number}"]`
  );
}

function isShuffleRef(bandId: string, albumId: string): boolean {
  return bandId === SHUFFLE_ID || albumId.startsWith(SHUFFLE_ID);
}

function findAlbum(bandId: string, albumId: string): { band: Band; album: Album } | null {
  if (isShuffleRef(bandId, albumId) && shuffleVirtual) return shuffleVirtual;
  const band = catalog.bands.find((b) => b.id === bandId);
  const album = band?.albums.find((a) => a.albumId === albumId);
  if (!band || !album) return null;
  return { band, album };
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function buildShufflePlaylist(): { band: Band; album: Album } | null {
  const items = visibleItems();
  if (!items.length) return null;
  const flat: { band: Band; album: Album; track: import('./types').Track }[] = items.flatMap((it) => it.album.tracks.map((tr) => ({ band: it.band, album: it.album, track: tr })));
  if (!flat.length) return null;
  const shuffled = shuffleArray(flat);
  const picked: import('./types').Track[] = [];
  shuffleOrigin = new Map();
  let total = 0;
  for (const entry of shuffled) {
    const dur = entry.track.duration != null && Number.isFinite(entry.track.duration) ? entry.track.duration : SHUFFLE_FALLBACK_DURATION;
    const num = picked.length + 1;
    picked.push({ ...entry.track, number: num });
    shuffleOrigin.set(num, { band: entry.band, album: entry.album });
    total += dur;
    if (total >= SHUFFLE_DURATION_TARGET) break;
  }
  const title = t('player.shuffle_title');
  const band: Band = { id: SHUFFLE_ID, name: t('player.shuffle_band'), yearsActive: '', logoUrl: null, history: null, historyEn: null, albums: [] };
  const album: Album = { albumId: `${SHUFFLE_ID}:${Date.now()}`, title, year: null, releaseDate: null, coverUrl: null, bandcampUrl: null, tracks: picked };
  shuffleVirtual = { band, album };
  return { band, album };
}

function playShuffle(): void {
  const built = buildShufflePlaylist();
  if (!built) return;
  const { band, album } = built;
  albumSelected = true;
  selectedRef = { bandId: band.id, albumId: album.albumId };
  panelVisible = true;
  renderDetail(band.id, album.albumId);
  applyViewport();
  playQueue(band, album, album.tracks, 0);
}

function syncShuffleButton(): void {
  const btn = document.getElementById('pb-shuffle') as HTMLButtonElement | null;
  if (!btn) return;
  const has = visibleItems().length > 0 && visibleItems().flatMap((it) => it.album.tracks).length > 0;
  btn.disabled = !has;
  btn.setAttribute('aria-disabled', String(!has));
  btn.classList.toggle('opacity-30', !has);
  btn.classList.toggle('cursor-not-allowed', !has);
  btn.title = has ? t('player.shuffle') : t('player.shuffle_empty');
  btn.setAttribute('aria-label', has ? t('player.shuffle') : t('player.shuffle_empty'));
}

function syncRepeatButton(): void {
  const btn = document.getElementById('pb-repeat') as HTMLButtonElement | null;
  const badge = document.getElementById('pb-repeat-badge') as HTMLElement | null;
  if (!btn) return;
  const mode: RepeatMode = getRepeatMode();
  const isActive = mode !== 'off';
  btn.classList.toggle('opacity-40', !isActive);
  btn.classList.toggle('opacity-100', isActive);
  btn.classList.toggle('text-accent', isActive);
  btn.classList.toggle('text-zinc-100', !isActive);
  if (badge) badge.classList.toggle('hidden', mode !== 'one');
  const key = mode === 'all' ? 'player.repeat_all' : mode === 'one' ? 'player.repeat_one' : 'player.repeat_off';
  const label = t(key);
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('data-i18n-aria', key);
  btn.setAttribute('aria-pressed', String(isActive));
}

function refreshFavButton(ref: TrackRef): void {
  const row = trackRow(ref);
  if (!row) return;
  const on = favorites.has(favKey(ref));
  const btn = row.querySelector<HTMLElement>('[data-fav-btn]');
  row.dataset.fav = String(on);
  if (btn) {
    btn.classList.toggle('text-accent', on);
    btn.classList.toggle('opacity-30', !on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

function refreshAllFav(): void {
  mainEl.querySelectorAll<HTMLElement>('.track-row').forEach((row) => {
    const ref = trRef(row);
    if (ref) refreshFavButton(ref);
  });
}

function highlightPlaying(state: PlayerState): void {
  mainEl.querySelectorAll<HTMLElement>('.track-row.is-playing').forEach((el) => {
    el.classList.remove('is-playing');
    el.dataset.playing = 'false';
  });
  if (state.track && state.album) {
    const row = mainEl.querySelector<HTMLElement>(
      `.track-row[data-band="${state.band?.id}"][data-album="${state.album.albumId}"][data-number="${state.track.number}"]`
    );
    if (row) {
      row.classList.add('is-playing');
      row.dataset.playing = 'true';
    }
  }
}

function toggleFavorite(ref: TrackRef): void {
  const key = favKey(ref);
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  writeJSON(KEYS.favorites, Array.from(favorites));
  refreshFavButton(ref);
  updateFavCount();
  renderAll();
}

function updateFavCount(): void {
  const el = document.getElementById('fav-count');
  if (el) el.textContent = String(favorites.size);
}

function updateAlbumCount(n: number): void {
  const el = document.getElementById('album-count');
  if (el) {
    const key = n === 1 ? 'search.albumCount_one' : 'search.albumCount_other';
    el.textContent = t(key, { n });
  }
}

function playTrack(row: HTMLElement): void {
  const ref = trRef(row);
  if (!ref) return;
  const found = findAlbum(ref.bandId, ref.albumId);
  if (!found) return;
  const { band, album } = found;
  const index = album.tracks.findIndex((t) => t.number === ref.number);
  if (index < 0) return;
  playQueue(band, album, album.tracks, index);
}

function albumItems(): AlbumItem[] {
  return catalog.bands.flatMap((b) => b.albums.map((a) => ({ band: b, album: a })));
}

function dateKey(item: AlbumItem): string {
  return item.album.releaseDate || (item.album.year != null ? String(item.album.year) : '');
}

function sortedItems(items: AlbumItem[]): AlbumItem[] {
  return [...items].sort((x, y) => {
    let c: number;
    if (sortField === 'date') {
      c = dateKey(x).localeCompare(dateKey(y));
      if (c === 0) c = normalize(x.album.title).localeCompare(normalize(y.album.title));
    } else {
      c = normalize(x.album.title).localeCompare(normalize(y.album.title));
      if (c === 0) c = dateKey(x).localeCompare(dateKey(y));
    }
    return sortDir === 'asc' ? c : -c;
  });
}

function albumHasFavorite(item: AlbumItem): boolean {
  return item.album.tracks.some((t) => favorites.has(favKey({ bandId: item.band.id, albumId: item.album.albumId, number: t.number })));
}

function visibleItems(): AlbumItem[] {
  const q = normalize(query.trim());
  const only = !!favToggleBtn?.classList.contains('active');
  return sortedItems(
    albumItems().filter((it) => {
      const nameMatch = !q || normalize(it.album.title).includes(q) || normalize(it.band.name).includes(q);
      const favMatch = !only || albumHasFavorite(it);
      const bandMatch = !filterBand || it.band.id === filterBand;
      const genreMatch = !filterGenre || bandGenres.get(it.band.id)?.genre === filterGenre;
      return nameMatch && favMatch && bandMatch && genreMatch;
    })
  );
}

function renderAlbumGrid(items: AlbumItem[]): void {
  const grid = document.getElementById('album-grid');
  if (!grid) return;
  const html = items
    .map((it) => {
      const cover = it.album.coverUrl || emptyCover;
      return `
        <button
          class="album-card group text-left cursor-pointer"
          data-band="${it.band.id}"
          data-album="${it.album.albumId}"
          data-album-title="${it.album.title.replace(/"/g, '&quot;')}"
        >
          <div class="cover-wrapper aspect-square overflow-hidden rounded mb-2 relative bg-base-surface">
            <img
              class="w-full h-full object-cover transition-transform group-hover:scale-105"
              src="${cover}"
              alt="${it.album.title.replace(/"/g, '&quot;')}"
              loading="lazy"
              onerror="this.src=this.dataset.fb;"
              data-fb="${emptyCover}"
            />
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span class="text-2xl">▶</span>
            </div>
          </div>
          <p class="font-bold text-sm uppercase tracking-wide truncate">${it.album.title}</p>
          <p class="text-xs opacity-70">${it.album.year ?? ''}</p>
        </button>`;
    })
    .join('');
  grid.innerHTML = html;
}

function renderAll(): void {
  const items = visibleItems();
  renderAlbumGrid(items);
  updateAlbumCount(items.length);
  const empty = document.getElementById('empty-state');
  if (empty) {
    const active = !!query.trim() || !!favToggleBtn?.classList.contains('active');
    empty.classList.toggle('hidden', !(active && items.length === 0));
  }
  refreshAllFav();
  syncShuffleButton();
}

function coverImg(url: string | null, alt: string): string {
  const src = url || emptyCover;
  return `<img class="w-full h-auto rounded border border-base-border" src="${src}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" onerror="this.src=this.dataset.fb;" data-fb="${emptyCover}" />`;
}

function bandStyleFor(bandId: string): string {
  const g = bandGenres.get(bandId);
  if (!g) return t('detail.style_fallback');
  const lang = getLang();
  const fallback = t('detail.style_fallback');
  if (lang === 'en') return g.styleEn || g.styleEs || fallback;
  return g.styleEs || g.styleEn || fallback;
}

function renderDetail(bandId: string, albumId: string): void {
  const el = document.getElementById('album-detail');
  if (!el) return;
  if (isShuffleRef(bandId, albumId) && shuffleVirtual) {
    const { band, album } = shuffleVirtual;
    const rows = album.tracks
      .map((track) => {
        return `
        <div class="track-row flex items-center gap-2 px-2 py-1.5 rounded hover:bg-base-surface cursor-pointer flex-wrap"
             data-band="${band.id}" data-album="${album.albumId}" data-number="${track.number}"
             data-playing="false">
            <span class="track-num opacity-40 w-6 text-right shrink-0 tabular-nums">${track.number}</span>
            <span class="track-title flex-1 min-w-0 truncate">${track.title}</span>
            <span class="opacity-40 tabular-nums ml-auto shrink-0">${formatTime(track.duration ?? 0)}</span>
         </div>`;
       })
       .join('');
     const titleClass = gridVisible ? 'text-xl' : 'text-2xl md:text-3xl';
     const infoHtml = `
     <div>
       <h3 class="${titleClass} leading-tight font-heading uppercase tracking-wider">${album.title}</h3>
     </div>
     <div class="space-y-1">${rows}</div>`;
    el.innerHTML = infoHtml;
    refreshAllFav();
    return;
  }
  const found = findAlbum(bandId, albumId);
  if (!found) return;
  const { band, album } = found;
  const rows = album.tracks
    .map((track) => {
      const hay = normalize([track.title, band.name, album.title].join(' '));
      const lyricsBtn = track.lyrics
        ? `<button data-lyrics-btn class="text-xs opacity-50 hover:opacity-100 shrink-0 leading-none" title="${t('track.lyrics_title')}" aria-label="${t('track.lyrics_aria')}">❝</button>`
        : '';
      const lyricsPanel = track.lyrics
        ? `<div data-lyrics-panel class="hidden w-full whitespace-pre-line text-sm opacity-70 border-l-2 border-accent/40 pl-4 pt-1">${track.lyrics.replace(/"/g, '&quot;')}</div>`
        : '';
      return `
        <div class="track-row flex items-center gap-2 px-2 py-1.5 rounded hover:bg-base-surface cursor-pointer flex-wrap"
             data-band="${band.id}" data-album="${album.albumId}" data-number="${track.number}"
             data-playing="false" data-search="${hay}">
           <span class="track-num opacity-40 w-6 text-right shrink-0 tabular-nums">${track.number}</span>
           <span class="track-title flex-1 min-w-0 truncate">${track.title}</span>
          <div class="flex items-center gap-2 shrink-0 ml-auto">
            ${lyricsBtn}
            <span class="opacity-40 tabular-nums mr-1">${formatTime(track.duration ?? 0)}</span>
            <button data-fav-btn class="opacity-30 hover:opacity-100 shrink-0" aria-label="${t('track.fav_aria')}" aria-pressed="false" hidden>♥</button>
          </div>
          ${lyricsPanel}
        </div>`;
    })
    .join('');

  const bandStyle = bandStyleFor(band.id);
  const titleClass = gridVisible ? 'text-xl' : 'text-2xl md:text-3xl';
  const logoHtml = `
    <div class="flex justify-center items-center min-h-[80px] bg-base-surface/20 rounded">
      <img class="max-h-20 w-auto object-contain" src="${band.logoUrl || ''}" alt="${band.name.replace(/"/g, '&quot;')}" loading="eager" decoding="async" fetchpriority="high" width="400" height="80" onerror="this.style.visibility='hidden'" />
    </div>`;
  const bandLine = bandStyle
    ? `<div class="flex items-baseline gap-2 text-xs opacity-50 uppercase tracking-widest font-bold">
        <span class="opacity-60">${bandStyle}</span>
      </div>`
    : '';
  const playAllHtml = `
    <button
      data-play-all
      data-band="${band.id}"
      data-album="${album.albumId}"
      class="bg-base-surface border border-base-border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-accent hover:text-zinc-100"
    >
      ${t('detail.play_all')}
    </button>`;
  const infoHtml = `
    <div>
      <h3 class="${titleClass} leading-tight font-heading uppercase tracking-wider">${album.title}</h3>
      <p class="text-xs opacity-60 uppercase tracking-widest mt-1">${formatDate(album.releaseDate) || album.year || ''}</p>
    </div>
    ${bandLine}
    ${playAllHtml}
    <div class="space-y-1">${rows}</div>`;

  el.innerHTML = gridVisible
    ? `${logoHtml}${coverImg(album.coverUrl, album.title)}${infoHtml}`
    : `${logoHtml}
    <div class="flex flex-col md:flex-row gap-6 items-start">
      <div class="w-full md:w-64 lg:w-72 shrink-0">${coverImg(album.coverUrl, album.title)}</div>
      <div class="flex-1 min-w-0">${infoHtml}</div>
    </div>`;
  refreshAllFav();
}

function selectAlbum(bandId: string, albumId: string): void {
  if (!findAlbum(bandId, albumId)) return;
  albumSelected = true;
  selectedRef = { bandId, albumId };
  panelVisible = true;
  renderDetail(bandId, albumId);
  applyViewport();
}

function syncPanelToggle(): void {
  const panel = document.getElementById('album-detail-panel');
  const btn = document.getElementById('panel-toggle');
  if (!panel || !btn) return;
  const open = !panel.classList.contains('hidden');
  btn.textContent = open ? t('panel.toggle_details_open') : t('panel.toggle_details_closed');
}

function syncGridToggle(): void {
  const gridArea = document.getElementById('grid-area');
  const btn = document.getElementById('grid-toggle');
  if (!gridArea || !btn) return;
  const open = !gridArea.classList.contains('hidden');
  btn.textContent = open ? t('panel.toggle_covers_open') : t('panel.toggle_covers_closed');
}

function applyViewport(): void {
  const panel = document.getElementById('album-detail-panel');
  const gridArea = document.getElementById('grid-area');
  if (panel) panel.classList.toggle('hidden', !panelVisible);
  if (gridArea) gridArea.classList.toggle('hidden', !gridVisible);
  syncShuffleButton();
  syncRepeatButton();
  if (panel) {
    panel.classList.toggle('md:w-[340px]', gridVisible);
    panel.classList.toggle('md:w-auto', !gridVisible);
    panel.classList.toggle('md:flex-1', !gridVisible);
  }
  syncPanelToggle();
  syncGridToggle();

  const expanded = !gridVisible && panelVisible;
  if (expanded !== lastExpanded && selectedRef) {
    renderDetail(selectedRef.bandId, selectedRef.albumId);
    const st = getState();
    if (st.track) highlightPlaying(st);
  }
  lastExpanded = expanded;
}

function togglePanel(): void {
  if (panelVisible) {
    panelVisible = false;
    gridVisible = true;
  } else {
    panelVisible = true;
  }
  applyViewport();
}

function toggleGrid(): void {
  if (!albumSelected) return;
  if (gridVisible) {
    gridVisible = false;
    panelVisible = true;
  } else {
    gridVisible = true;
  }
  applyViewport();
}

function resetFilters(): void {
  favToggleBtn.classList.remove('active');
  favToggleBtn.setAttribute('aria-pressed', 'false');
  searchInput.value = '';
  query = '';
  filterBand = '';
  filterGenre = '';
  const bandFilterEl = document.getElementById('band-filter') as HTMLSelectElement | null;
  if (bandFilterEl) bandFilterEl.value = '';
  const genreFilterEl = document.getElementById('genre-filter') as HTMLSelectElement | null;
  if (genreFilterEl) genreFilterEl.value = '';
  renderAll();
}

function bindEvents(): void {
  mainEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const playBtn = target.closest<HTMLElement>('[data-play-btn]');
    if (playBtn) {
      const row = playBtn.closest<HTMLElement>('.track-row');
      if (!row) return;
      e.stopPropagation();
      if (row.dataset.playing === 'true') {
        togglePlay();
        return;
      }
      playTrack(row);
      return;
    }

    const favBtn = target.closest<HTMLElement>('[data-fav-btn]');
    if (favBtn) {
      const row = favBtn.closest<HTMLElement>('.track-row');
      if (!row) return;
      e.stopPropagation();
      const ref = trRef(row);
      if (ref) toggleFavorite(ref);
      return;
    }

    const lyricsBtn = target.closest<HTMLElement>('[data-lyrics-btn]');
    if (lyricsBtn) {
      const row = lyricsBtn.closest<HTMLElement>('.track-row');
      if (!row) return;
      e.stopPropagation();
      const panel = row.querySelector<HTMLElement>('[data-lyrics-panel]');
      if (panel) panel.classList.toggle('hidden');
      return;
    }

    const playAllBtn = target.closest<HTMLElement>('[data-play-all]');
    if (playAllBtn) {
      e.stopPropagation();
      const found = findAlbum(playAllBtn.dataset.band || '', playAllBtn.dataset.album || '');
      if (found) playQueue(found.band, found.album, found.album.tracks, 0);
      return;
    }

    const albumCard = target.closest<HTMLElement>('.album-card');
    if (albumCard) {
      const bandId = albumCard.dataset.band || '';
      const albumId = albumCard.dataset.album || '';
      if (findAlbum(bandId, albumId)) selectAlbum(bandId, albumId);
      return;
    }

    const panelHide = target.closest<HTMLElement>('[data-panel-hide]');
    if (panelHide) {
      togglePanel();
    }
  });

  mainEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.track-row');
    if (row && !(e.target as HTMLElement).closest('[data-play-btn],[data-fav-btn],[data-lyrics-btn]')) {
      playTrack(row);
    }
  });

  document.getElementById('panel-toggle')?.addEventListener('click', togglePanel);
  document.getElementById('grid-toggle')?.addEventListener('click', toggleGrid);

  const filtersToggle = document.getElementById('filters-toggle');
  const filtersGroup = document.getElementById('filters-group');
  filtersToggle?.addEventListener('click', () => {
    if (!filtersGroup) return;
    const hidden = filtersGroup.classList.toggle('hidden');
    filtersToggle.textContent = hidden ? t('filters.toggle_closed') : t('filters.toggle_open');
    filtersToggle.setAttribute('aria-expanded', String(!hidden));
  });

  const toggle = document.getElementById('pb-toggle');
  toggle?.addEventListener('click', togglePlay);

  document.getElementById('pb-next')?.addEventListener('click', next);
  document.getElementById('pb-prev')?.addEventListener('click', prev);
  document.getElementById('pb-shuffle')?.addEventListener('click', playShuffle);
  document.getElementById('pb-repeat')?.addEventListener('click', () => {
    cycleRepeat();
    syncRepeatButton();
  });

  const pbTrack = document.getElementById('pb-track') as HTMLElement | null;
  const seekFromClientX = (clientX: number): void => {
    if (!pbTrack) return;
    const rect = pbTrack.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const dur = getState().duration;
    if (dur > 0) seek(ratio * dur);
  };
  pbTrack?.addEventListener('click', (e) => seekFromClientX((e as MouseEvent).clientX));
  pbTrack?.addEventListener('keydown', (e) => {
    const dur = getState().duration;
    const cur = getState().currentTime;
    if (dur <= 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(Math.max(0, cur - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(Math.min(dur, cur + 5));
    } else if (e.key === 'Home') {
      e.preventDefault();
      seek(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      seek(dur);
    }
  });
  let dragging = false;
  const onMove = (e: MouseEvent | TouchEvent): void => {
    if (!dragging) return;
    const x = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    seekFromClientX(x);
  };
  const stopDrag = (): void => {
    dragging = false;
  };
  pbTrack?.addEventListener('mousedown', (e) => {
    dragging = true;
    seekFromClientX((e as MouseEvent).clientX);
  });
  pbTrack?.addEventListener(
    'touchstart',
    (e) => {
      dragging = true;
      seekFromClientX((e as TouchEvent).touches[0].clientX);
    },
    { passive: true }
  );
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: true } as AddEventListenerOptions);
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('touchend', stopDrag);

  searchInput = document.getElementById('search-input') as HTMLInputElement;
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderAll();
  });

  favToggleBtn = document.getElementById('nav-favorites') as HTMLButtonElement;
  favToggleBtn.addEventListener('click', () => {
    favToggleBtn.classList.toggle('active');
    favToggleBtn.setAttribute('aria-pressed', String(favToggleBtn.classList.contains('active')));
    renderAll();
  });

  document.getElementById('filters-clear')?.addEventListener('click', () => {
    resetFilters();
  });

  const genreFilterEl = document.getElementById('genre-filter') as HTMLSelectElement | null;
  genreFilterEl?.addEventListener('change', () => {
    filterGenre = genreFilterEl.value;
    renderAll();
  });

  const bandFilterEl = document.getElementById('band-filter') as HTMLSelectElement | null;
  bandFilterEl?.addEventListener('change', () => {
    filterBand = bandFilterEl.value;
    renderAll();
  });

  const sortFieldEl = document.getElementById('sort-field') as HTMLSelectElement | null;
  sortFieldEl?.addEventListener('change', () => {
    sortField = sortFieldEl.value === 'date' ? 'date' : 'name';
    renderAll();
  });

  const sortDirBtn = document.getElementById('sort-dir');
  sortDirBtn?.addEventListener('click', () => {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    sortDirBtn.textContent = sortDir === 'asc' ? '↑' : '↓';
    renderAll();
  });

  window.addEventListener('langchange', () => {
    emptyCover = getEmptyCover();
    updateAlbumCount(visibleItems().length);
    syncPanelToggle();
    syncGridToggle();
    syncShuffleButton();
    syncRepeatButton();
    const ft = document.getElementById('filters-toggle');
    const fg = document.getElementById('filters-group');
    if (ft && fg) {
      const hidden = fg.classList.contains('hidden');
      ft.textContent = hidden ? t('filters.toggle_closed') : t('filters.toggle_open');
    }
    if (selectedRef) renderDetail(selectedRef.bandId, selectedRef.albumId);
    else renderAll();
    const sh = document.getElementById('pb-shuffle');
    if (sh) sh.setAttribute('aria-label', t('player.shuffle'));
  });
}

function setText(sel: string, val: string): void {
  const el = document.querySelector(sel);
  if (el) el.textContent = val;
}

function persistPlayer(s: PlayerState): void {
  const base = s.queueContext;
  if (base?.band.id === SHUFFLE_ID || base?.album.albumId.startsWith(SHUFFLE_ID)) return;
  const refs: TrackRef[] = s.queue.map((t) => ({
    bandId: base?.band.id ?? '',
    albumId: base?.album.albumId ?? '',
    number: t.number,
  }));
  const data: PersistedPlayer = {
    ref:
      s.track && base
        ? { bandId: base.band.id, albumId: base.album.albumId, number: s.track.number }
        : null,
    queue: refs,
    index: s.index,
    position: s.currentTime,
  };
  writeJSON(KEYS.player, data);
}

function initPlayerBar(): void {
  let lastPersist = 0;
  subscribe((s) => {
    const now = Date.now();
    const throttleMs = 1000;
    if (now - lastPersist >= throttleMs) {
      lastPersist = now;
      persistPlayer(s);
    }
    syncRepeatButton();
    if (!s.track) return;

    const isShuffle = s.band?.id === SHUFFLE_ID && s.track;
    const origin = isShuffle ? shuffleOrigin.get(s.track!.number) ?? null : null;
    const displayAlbum = origin?.album ?? s.album;
    const displayBand = origin?.band ?? s.band;
    const cover = document.getElementById('pb-cover') as HTMLImageElement | null;
    if (cover) {
      cover.src = displayAlbum?.coverUrl?.replace(/_\d+(\.\w+)$/, '_10$1') || '';
      cover.style.visibility = displayAlbum?.coverUrl ? 'visible' : 'hidden';
    }

    setText('#pb-title', s.track?.title ?? '');
    setText('#pb-album', displayAlbum?.title ?? '');
    setText('#pb-band', displayBand?.name ?? '');
    if (isShuffle && origin && typeof navigator !== 'undefined' && 'mediaSession' in navigator && s.track) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: s.track.title,
          artist: origin.band.name,
          album: origin.album.title,
          artwork: origin.album.coverUrl ? [{ src: origin.album.coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
        });
      } catch {}
    }
    setText('#pb-cur', formatTime(s.currentTime));
    setText('#pb-dur', formatTime(s.duration));

    const track = document.getElementById('pb-track') as HTMLElement | null;
    if (track) {
      track.setAttribute('aria-valuemax', String(Math.floor(s.duration || 0)));
      track.setAttribute('aria-valuenow', String(Math.floor(s.currentTime || 0)));
    }

    const progress = document.getElementById('pb-progress') as HTMLElement | null;
    if (progress) {
      const pct = s.duration > 0 ? (s.currentTime / s.duration) * 100 : 0;
      progress.style.width = `${pct}%`;
    }

    const toggleBtn = document.getElementById('pb-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = s.isPlaying ? '⏸' : '▶';
      toggleBtn.setAttribute('aria-label', s.isPlaying ? t('player.pause') : t('player.play'));
    }

    highlightPlaying(s);
  });
}

function restorePlayer(): void {
  const data = readJSON<PersistedPlayer | null>(KEYS.player, null);
  if (!data || !data.queue.length) return;
  const ref = data.ref || data.queue[0];
  if (!ref) return;
  if (ref.bandId === SHUFFLE_ID || ref.albumId.startsWith(SHUFFLE_ID)) return;
  if (data.queue.some((r) => r.bandId === SHUFFLE_ID || r.albumId.startsWith(SHUFFLE_ID))) return;
  const found = findTrack(catalog, ref);
  if (!found) return;
  const { band, album } = found;
  const queue = data.queue
    .map((r) => findTrack(catalog, r)?.track)
    .filter((t): t is NonNullable<typeof t> => !!t);
  if (!queue.length) {
    setQueueOnly(band, album, [found.track], 0);
  } else {
    const index = Math.max(0, Math.min(data.index, queue.length - 1));
    setQueueOnly(band, album, queue, index);
  }
  seekToPosition(data.position ?? 0);
}

let initialized = false;

function prefetchBandLogos(): void {
  const urls = catalog.bands.map((b) => b.logoUrl).filter((u): u is string => !!u);
  if (!urls.length) return;
  const run = (): void => {
    for (const url of urls) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'image';
      link.href = url;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      const img = new Image();
      (img as HTMLImageElement & { decoding: string }).decoding = 'async';
      img.src = url;
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(() => run(), { timeout: 2000 });
  else setTimeout(run, 1200);
}

function init(): void {
  if (initialized) return;
  initialized = true;
  const jsonEl = document.getElementById('catalog-json');
  if (!jsonEl) return;
  try {
    catalog = JSON.parse(jsonEl.textContent || '{"bands":[]}') as Catalog;
  } catch {
    catalog = { generatedAt: '', source: '', bands: [] };
  }

  const genreEl = document.getElementById('band-genres');
  if (genreEl) {
    try {
      const raw = JSON.parse(genreEl.textContent || '{}') as Record<string, { genre: string; styleEs: string; styleEn: string }>;
      const migrated: Record<string, { genre: string; styleEs: string; styleEn: string }> = {};
      for (const [k, v] of Object.entries(raw)) {
        if ('style' in (v as unknown as Record<string, string>) && !('styleEs' in v)) {
          const old = v as unknown as { genre: string; style: string };
          migrated[k] = { genre: old.genre, styleEs: old.style, styleEn: old.style };
        } else {
          migrated[k] = v as { genre: string; styleEs: string; styleEn: string };
        }
      }
      bandGenres = new Map(Object.entries(migrated));
    } catch {
      bandGenres = new Map();
    }
  }

  mainEl = document.getElementById('browse-main') as HTMLElement;
  favorites = new Set(readJSON<string[]>(KEYS.favorites, []));
  updateFavCount();

  bindEvents();
  initPlayerBar();
  restorePlayer();
  applyViewport();
  renderAll();
  prefetchBandLogos();
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
