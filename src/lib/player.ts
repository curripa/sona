import type { Album, Band, Track } from './types';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  band: Band | null;
  album: Album | null;
  track: Track | null;
  queue: Track[];
  queueContext: { band: Band; album: Album } | null;
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  repeatMode: RepeatMode;
}

export type Listener = (state: PlayerState) => void;

const audio = new Audio();
audio.preload = 'none';

let state: PlayerState = {
  band: null,
  album: null,
  track: null,
  queue: [],
  queueContext: null,
  index: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  repeatMode: 'off',
};

const msSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

function updateMediaSession(): void {
  if (!msSupported) return;
  const { track, queueContext } = state;
  if (!track || !queueContext) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: queueContext.band.name,
    album: queueContext.album.title,
    artwork: queueContext.album.coverUrl
      ? [{ src: queueContext.album.coverUrl, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });
}

function updatePlaybackState(): void {
  if (!msSupported) return;
  navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
}

function updatePositionState(): void {
  if (!msSupported) return;
  if (state.duration > 0 && Number.isFinite(state.duration)) {
    navigator.mediaSession.setPositionState({
      duration: state.duration,
      playbackRate: 1,
      position: Math.min(state.currentTime, state.duration),
    });
  }
}

function setupMediaSession(): void {
  if (!msSupported) return;
  const wrap = <T extends (...args: any[]) => void>(fn: T): T => {
    return ((...args: any[]) => {
      try { fn(...args); } catch { /* ignore unsupported actions */ }
    }) as unknown as T;
  };
  navigator.mediaSession.setActionHandler('play', wrap(play));
  navigator.mediaSession.setActionHandler('pause', wrap(pause));
  navigator.mediaSession.setActionHandler('previoustrack', wrap(prev));
  navigator.mediaSession.setActionHandler('nexttrack', wrap(next));
  navigator.mediaSession.setActionHandler('seekto', wrap((d: MediaSessionActionDetails) => {
    if (d.seekTime != null) seek(d.seekTime);
  }));
  navigator.mediaSession.setActionHandler('seekbackward', wrap((d: MediaSessionActionDetails) => {
    const offset = d.seekOffset ?? 10;
    seek(state.currentTime - offset);
  }));
  navigator.mediaSession.setActionHandler('seekforward', wrap((d: MediaSessionActionDetails) => {
    const offset = d.seekOffset ?? 10;
    seek(state.currentTime + offset);
  }));
}

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((fn) => fn(state));
}

audio.addEventListener('timeupdate', () => {
  state = { ...state, currentTime: audio.currentTime };
  updatePositionState();
  notify();
});

audio.addEventListener('durationchange', () => {
  state = { ...state, duration: Number.isFinite(audio.duration) ? audio.duration : 0 };
  updatePositionState();
  notify();
});

audio.addEventListener('play', () => {
  state = { ...state, isPlaying: true };
  updatePlaybackState();
  notify();
});

audio.addEventListener('pause', () => {
  state = { ...state, isPlaying: false };
  updatePlaybackState();
  notify();
});

audio.addEventListener('ended', () => {
  if (state.index < state.queue.length - 1) {
    playAt(state.index + 1);
  } else if (state.repeatMode === 'all' && state.queue.length > 0) {
    playAt(0);
  } else {
    state = {
      ...state,
      index: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    };
    audio.src = '';
    notify();
  }
});

audio.addEventListener('error', () => {
  state = { ...state, isPlaying: false };
  notify();
});

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => {
    listeners.delete(fn);
  };
}

export function getState(): PlayerState {
  return state;
}

function loadTrack(track: Track): void {
  if (audio.src !== track.audioUrl) {
    audio.src = track.audioUrl;
    audio.load();
  }
}

function safePlay(): void {
  let result: void | Promise<void>;
  try {
    result = audio.play();
  } catch {
    state = { ...state, isPlaying: false };
    notify();
    return;
  }
  if (result && typeof result.catch === 'function') {
    result.catch(() => {
      state = { ...state, isPlaying: false };
      notify();
    });
  } else {
    state = { ...state, isPlaying: true };
    notify();
  }
}

function playAt(index: number): void {
  const track = state.queue[index];
  const ctx = state.queueContext;
  if (!track || !ctx) return;
  const sameSrc = audio.src === track.audioUrl && state.track?.audioUrl === track.audioUrl;
  state = {
    ...state,
    band: ctx.band,
    album: ctx.album,
    track,
    index,
    currentTime: 0,
    duration: sameSrc && state.duration > 0 ? state.duration : 0,
  };
  if (sameSrc) {
    try { audio.currentTime = 0; } catch {}
  } else {
    loadTrack(track);
  }
  audio.loop = state.repeatMode === 'one';
  updateMediaSession();
  safePlay();
  notify();
}

export function playQueue(band: Band, album: Album, tracks: Track[], startIndex: number): void {
  state = {
    ...state,
    queue: tracks,
    queueContext: { band, album },
    index: startIndex,
    isPlaying: true,
  };
  playAt(startIndex);
}

export function setQueueOnly(band: Band, album: Album, tracks: Track[], startIndex: number): void {
  state = {
    ...state,
    band,
    album,
    track: tracks[startIndex] ?? null,
    queue: tracks,
    queueContext: { band, album },
    index: startIndex,
    currentTime: 0,
    duration: 0,
  };
  updateMediaSession();
  notify();
}

export function play(): void {
  if (!state.track) return;
  safePlay();
}

export function pause(): void {
  audio.pause();
}

export function togglePlay(): void {
  if (!state.track) return;
  if (state.isPlaying) {
    pause();
  } else {
    play();
  }
}

export function seek(time: number): void {
  if (!Number.isFinite(time)) return;
  audio.currentTime = Math.max(0, Math.min(time, state.duration || time));
  state = { ...state, currentTime: audio.currentTime };
  notify();
}

export function next(): void {
  if (state.index < state.queue.length - 1) {
    playAt(state.index + 1);
  } else if (state.repeatMode === 'all' && state.queue.length > 0) {
    playAt(0);
  }
}

export function prev(): void {
  if (!state.track) return;
  if (audio.currentTime > 3) {
    seek(0);
  } else if (state.index > 0) {
    playAt(state.index - 1);
  } else if (state.repeatMode === 'all' && state.queue.length > 0) {
    playAt(state.queue.length - 1);
  } else {
    seek(0);
  }
}

export function seekToPosition(position: number): void {
  if (!state.track || !Number.isFinite(position)) return;
  const restore = () => {
    audio.currentTime = Math.max(0, position);
    state = { ...state, currentTime: audio.currentTime };
    notify();
  };
  if (audio.readyState >= 1) {
    restore();
  } else {
    audio.addEventListener('loadedmetadata', restore, { once: true });
  }
}

export function getRepeatMode(): RepeatMode {
  return state.repeatMode;
}

export function setRepeatMode(mode: RepeatMode): void {
  if (state.repeatMode === mode) return;
  state = { ...state, repeatMode: mode };
  audio.loop = mode === 'one';
  notify();
}

export function cycleRepeat(): RepeatMode {
  const order: RepeatMode[] = ['off', 'all', 'one'];
  const idx = order.indexOf(state.repeatMode);
  const nextMode = order[(idx + 1) % order.length] as RepeatMode;
  setRepeatMode(nextMode);
  return nextMode;
}

export function clearPlayback(): void {
  state = {
    band: null,
    album: null,
    track: null,
    queue: [],
    queueContext: null,
    index: -1,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    repeatMode: state.repeatMode,
  };
  audio.loop = state.repeatMode === 'one';
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  updateMediaSession();
  notify();
}

setupMediaSession();