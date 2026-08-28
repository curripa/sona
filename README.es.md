<h1 align="center">SONA</h1>

<p align="center">Español · <a href="README.md">English</a></p>

**Sona** es un reproductor independiente para el catálogo de [curripa.github.io](https://curripa.github.io). Una aplicación estática de una sola página presenta todos los álbumes en una rejilla navegable y filtrable con un reproductor inferior persistente.

## Características

- **Rejilla de álbumes con panel de detalle**: rejilla responsive de portadas; al hacer clic en un álbum se abre un panel lateral fijo con portada, listado de canciones y reproducción completa.
- **Barra de reproducción integrada**: barra fija inferior con portada, info de canción/álbum/grupo, anterior/play/siguiente, mezcla aleatoria y repetición (desactivado/todo/uno), barra de progreso navegable, atajos de teclado (flechas/Inicio/Fin) e integración con Media Session.
- **Búsqueda y filtros**: búsqueda por álbum o grupo, filtro por estilo (metal/punk/alternativo/otro) y por grupo, orden por fecha o nombre (asc/desc), grupo de filtros colapsable en móvil.
- **Mezcla aleatoria**: genera una playlist aleatoria de ~1 hora a partir de los álbumes visibles.
- **Favoritas**: marca canciones como favoritas (persistidas en `localStorage`), filtra para mostrar solo álbumes con favoritas y contador de favoritas.
- **Letras**: panel expandible de letras por canción cuando están disponibles.
- **Bilingüe (es/en)**: idioma detectado desde el navegador (español por defecto), con persistencia en `localStorage`.
- **Tema oscuro**: diseño solo oscuro con *Bebas Neue* (títulos) y *JetBrains Mono* (texto).
- **Estática y ligera**: se genera como HTML estático en el build; audio y portadas se sirven desde `curripa.github.io`; sin backend.

## Stack

- [Astro](https://astro.build) (generación de sitio estático)
- [Tailwind CSS](https://tailwindcss.com)
- Tipografías: *Bebas Neue* (títulos) y *JetBrains Mono* (texto)
- Despliegue en **GitHub Pages** mediante GitHub Actions

## Estructura del proyecto

```
.
├── .github/workflows/deploy.yml   # CI/CD: build + despliegue a Pages
├── astro.config.mjs               # Configuración de Astro (site + base para /sona/)
├── tailwind.config.cjs
├── package.json
├── scripts/
│   ├── fetch-curripa.mjs          # Scraper → JSON del catálogo desde curripa.github.io
│   └── smoke-test.mjs             # Smoke test (comprobaciones del build)
├── src/
│   ├── components/
│   │   └── PlayerBar.astro        # Barra inferior del reproductor
│   ├── data/
│   │   ├── config.json            # curripaOrigin, siteName, siteDescription
│   │   └── generated/catalog.json # Catálogo rascado desde curripa.github.io (no editar)
│   ├── i18n/
│   │   ├── dict.js                # Diccionario es/en
│   │   ├── init.js                # Binding del i18n al DOM
│   │   └── language.js            # Detección y persistencia del idioma
│   ├── layouts/BaseLayout.astro
│   ├── lib/
│   │   ├── app.ts                 # Rejilla, filtros, panel de detalle, wiring del player
│   │   ├── player.ts              # Cola de audio, play/pausa/siguiente/anterior/repetición
│   │   ├── search.ts              # Helpers de búsqueda
│   │   ├── storage.ts             # Helpers de localStorage
│   │   └── types.ts               # Tipos Catalog, Band, Album, Track
│   ├── pages/index.astro          # Página única (rejilla + panel)
│   └── styles/global.css
```

## Puesta en marcha

Requisitos: **Node.js 20+**.

```bash
npm install
npm run dev        # desarrollo en http://localhost:4321/sona/
npm run build      # genera el sitio en dist/
npm run preview    # sirve el build localmente
```

### Catálogo

El catálogo no se mantiene a mano: se obtiene rascando el HTML público de `curripa.github.io`. La URL de origen se configura en `src/data/config.json` (`curripaOrigin`); el script extrae las secciones de cada grupo, las fichas de discografía y los metadatos de canciones (incluyendo URLs de audio y letras) y escribe el resultado en `src/data/generated/catalog.json`.

```bash
npm run fetch      # actualiza src/data/generated/catalog.json desde curripaOrigin
```

`src/data/generated/catalog.json` es generado y no debería editarse a mano. Si la descarga falla, se preserva el snapshot existente. El sitio desplegado en `https://curripa.github.io/sona/` reproduce audio y portadas directamente desde `https://curripa.github.io/audio/` y `/img/covers/`.

## Internacionalización

La web se genera en español y se adapta al inglés según el idioma del navegador. Las cadenas están en `src/i18n/dict.js`:

- `data-i18n` → reemplaza el contenido de texto.
- `data-i18n-aria` → reemplaza el atributo `aria-label`.
- `data-i18n-placeholder` → reemplaza el atributo `placeholder`.
- Persistencia vía `localStorage` (`sona.lang`) y evento `langchange` para re-renderizar.

## Despliegue

El flujo `.github/workflows/deploy.yml` se encarga de todo en cada push a `main` (y se puede lanzar manualmente desde *Actions*):

1. Instala dependencias.
2. Compila el sitio (`astro build`).
3. Publica `dist/` en **GitHub Pages**.

Para activarlo en un repositorio:

1. Sube el proyecto a GitHub.
2. En *Settings → Pages*, selecciona **GitHub Actions** como fuente de despliegue.
3. El flujo desplegará el sitio en `https://<usuario>.github.io/sona/`.

La URL del sitio y el path base se configuran en `astro.config.mjs` (`site` + `base`).
