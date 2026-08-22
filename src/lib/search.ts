import type { Album, Band, Catalog, Track } from './types';

export interface SearchResult {
  bands: Band[];
  albums: Array<{ band: Band; album: Album }>;
  tracks: Array<{ band: Band; album: Album; track: Track }>;
}

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function searchCatalog(catalog: Catalog, query: string): SearchResult {
  const q = normalize(query.trim());
  if (!q) return { bands: catalog.bands, albums: [], tracks: [] };

  const result: SearchResult = { bands: [], albums: [], tracks: [] };

  for (const band of catalog.bands) {
    if (normalize(band.name).includes(q)) {
      result.bands.push(band);
    }
    for (const album of band.albums) {
      if (normalize(album.title).includes(q)) {
        result.albums.push({ band, album });
      }
      for (const track of album.tracks) {
        const match =
          normalize(track.title).includes(q) ||
          normalize(band.name).includes(q) ||
          normalize(album.title).includes(q);
        if (match) {
          result.tracks.push({ band, album, track });
        }
      }
    }
  }

  return result;
}