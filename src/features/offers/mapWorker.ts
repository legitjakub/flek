import { setWorkerUrl } from 'maplibre-gl';
// `?worker&url` and not plain `?url`: the worker file starts with
// `import … from "./maplibre-gl-shared.mjs"`, so emitting it alone leaves that sibling
// unresolved and the worker dies on its first line. `?worker` makes Vite bundle it as a real
// entry, following the import, and `&url` hands back the emitted path.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

/*
 * MapLibre decodes vector tiles inside a web worker. It finds that worker at runtime with
 * `new URL(`./${file}`, import.meta.url)` — a template literal over a variable base, which
 * Vite's static analysis cannot match, so the worker asset was never emitted at all.
 *
 * The failure is close to silent, and that is what made it expensive: the style loads, the
 * TileJSON loads, the sprites load — all of those are main-thread fetches — while not a
 * single vector tile or glyph is ever requested, and `map.on('error')` stays quiet because
 * the worker's own SyntaxError never reaches the map. On Vercel it is quieter still: the
 * SPA rewrite answers the missing worker with 200 and an HTML page.
 *
 * Raster basemaps never touch the worker, which is why this went unnoticed for as long as
 * the app served Esri raster tiles, and why an earlier attempt at a vector basemap was
 * wrongly written off as "OpenFreeMap requests zero tiles".
 *
 * Imported for its side effect from OfferMap.tsx, the only module that constructs a map.
 */
setWorkerUrl(workerUrl);
