import { defineConfig } from '@playwright/test'

// E2E テスト（npm run test:e2e）。vitest の単体テスト（tests/）とは別で、拡張子 .e2e.ts のものだけを実行する。
// Navara（WebGPU/WASM）と Cesium が動くよう、システムの Chrome を使う
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173/KMLEarthPro/',
    viewport: { width: 1280, height: 800 },
    channel: 'chrome',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173/KMLEarthPro/',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
