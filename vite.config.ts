import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/KMLEarthPro/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  // MapLibre 6 はワーカーを別 ESM ファイルとして持ち、new URL(..., import.meta.url)
  // で参照する。事前バンドルするとこの参照が壊れてワーカーが生成されず、
  // スタイル読み込みが完了しないまま地図が空になる。
  optimizeDeps: {
    exclude: ['maplibre-gl'],
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
