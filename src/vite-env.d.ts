/// <reference types="vite/client" />

declare global {
  /** package.json の version（vite.config.ts の define で埋め込む） */
  const __APP_VERSION__: string
  /** 描画エンジンのバージョン（vite.config.ts が node_modules から読む） */
  const __ENGINE_VERSIONS__: { maplibre: string; navara: string; cesium: string }

  interface Window {
    /** Cesium が Workers/Assets を取得する基準 URL。Cesium のモジュール評価前に設定する */
    CESIUM_BASE_URL: string
  }
}

export {}
