export interface Track {
  number: number;
  title: string;
  duration: number | null;
  lyrics: string | null;
  audioUrl: string;
}

export interface Album {
  albumId: string;
  title: string;
  year: number | null;
  releaseDate: string | null;
  coverUrl: string | null;
  bandcampUrl: string | null;
  tracks: Track[];
}

export interface Band {
  id: string;
  name: string;
  yearsActive: string;
  logoUrl: string | null;
  history: string | null;
  historyEn: string | null;
  albums: Album[];
}

export interface Catalog {
  generatedAt: string;
  source: string;
  bands: Band[];
}

export interface TrackRef {
  bandId: string;
  albumId: string;
  number: number;
}

export function findTrack(catalog: Catalog, ref: TrackRef): { band: Band; album: Album; track: Track } | null {
  const band = catalog.bands.find((b) => b.id === ref.bandId);
  if (!band) return null;
  const album = band.albums.find((a) => a.albumId === ref.albumId);
  if (!album) return null;
  const track = album.tracks.find((t) => t.number === ref.number);
  if (!track) return null;
  return { band, album, track };
}