// MapLibre 6 はワーカーを別 ESM ファイルとして配布し、バンドル内では
// new URL('./maplibre-gl-worker.mjs', import.meta.url) で参照する。
// この相対解決はバンドル後に壊れる（dist/assets に当該ファイルが出力されない）ため、
// public/ に実体を置き setWorkerUrl() で明示的に指す。
// ワーカーは同階層の maplibre-gl-shared.mjs を import するので 2 ファイルとも必要。
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const distDir = dirname(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'))
const publicDir = join(process.cwd(), 'public')

mkdirSync(publicDir, { recursive: true })
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(distDir, file), join(publicDir, file))
}
