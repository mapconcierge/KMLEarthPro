/// <reference types="vite/client" />

declare global {
  interface Window {
    /** Cesium が Workers/Assets を取得する基準 URL。Cesium のモジュール評価前に設定する */
    CESIUM_BASE_URL: string
  }
}

export {}
