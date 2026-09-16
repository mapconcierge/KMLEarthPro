// バンドラが解決できない依存の静的アセットを public/ に配置する。
//
// MapLibre 6: ワーカーを別 ESM ファイルとして配布し、バンドル内では
//   new URL('./maplibre-gl-worker.mjs', import.meta.url) で参照する。この相対解決は
//   バンドル後に壊れる（dist/assets に実体が出力されない）ため setWorkerUrl() で
//   明示的に指す。ワーカーは同階層の maplibre-gl-shared.mjs を import するため両方必要。
//
// Cesium: Workers / Assets / Widgets / ThirdParty を実行時に CESIUM_BASE_URL からの
//   相対パスで取得する。
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const publicDir = join(process.cwd(), 'public')
mkdirSync(publicDir, { recursive: true })

const maplibreDist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'))
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(maplibreDist, file), join(publicDir, file))
}

const cesiumBuild = join(dirname(require.resolve('cesium/package.json')), 'Build/Cesium')
for (const dir of ['Workers', 'Assets', 'Widgets', 'ThirdParty']) {
  cpSync(join(cesiumBuild, dir), join(publicDir, 'cesium', dir), { recursive: true })
}
