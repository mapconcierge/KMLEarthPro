import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// 表示用バージョンは package.json を唯一の出典にする
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

// 画面に出す描画エンジンのバージョン。インストールされている実体の package.json を出典にする
const installed = (pkg: string) =>
  (JSON.parse(readFileSync(new URL(`./node_modules/${pkg}/package.json`, import.meta.url), 'utf-8')) as { version: string }).version
const engineVersions = {
  maplibre: installed('maplibre-gl'),
  navara: installed('@navaramap/three'),
  cesium: installed('cesium'),
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version), __ENGINE_VERSIONS__: JSON.stringify(engineVersions) },
  base: '/KMLEarthPro/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  server: {
    // Navara の WASM は crossOriginIsolated を要求する
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
