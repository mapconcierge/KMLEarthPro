# KML Earth Pro

Google Earth Pro の代替 Digital Earth Browser — OGC KML 2.3 対応 OSS Web アプリ

**A Google Earth Pro alternative Digital Earth Browser — OGC KML 2.3 compliant OSS web application**

[![Deploy to GitHub Pages](https://github.com/mapconcierge/KMLEarthPro/actions/workflows/deploy.yml/badge.svg)](https://github.com/mapconcierge/KMLEarthPro/actions/workflows/deploy.yml)

---

## 概要 / Overview

KML Earth Pro は、Google Earth Pro と同等の操作性・KML 互換性をブラウザ上で実現する OSS です。

- **KML/KMZ 対応**: OGC KML 2.3 全仕様の読み込み・実行・保存
- **3D エンジン**: [Navara](https://navara.world/)（既定）/ [CesiumJS](https://cesium.com/)（切替可）
- **2D エンジン**: [MapLibre GL JS](https://maplibre.org/)
- **静的配信**: GitHub Pages から無料で公開（必須サーバー・有料サービス不要）
- **ライセンス**: Apache-2.0

## 使い方 / Usage

1. [KML Earth Pro を開く](https://mapconcierge.github.io/KMLEarthPro/)
2. KML/KMZ ファイルをドラッグ＆ドロップ、または左サイドバーから読み込む
3. 地球儀を操作（Google Earth Pro 互換操作）

## ローカル開発 / Local Development

```bash
# 依存関係のインストール
pnpm install

# 開発サーバー起動
pnpm dev

# 型チェック
pnpm typecheck

# 本番ビルド
pnpm build
```

## プロジェクト構成 / Project Structure

```
src/
  components/     UI コンポーネント（地図ビュー、サイドバー、ステータスバー）
  kml/            KML 文書モデル・パーサー・実行系（実装予定）
  adapters/       Navara / Cesium / MapLibre アダプター（実装予定）
  workers/        Web Workers（XML解析・地形計算）（実装予定）
docs/
  kml-conformance.csv    KML 2.3 機能対応表
  claude-code-master-prompt.md  開発仕様書
```

## 開発段階 / Development Phases

| 段階 | 内容 | 状態 |
|------|------|------|
| Phase 0 | 基盤構築・GitHub Pages 配信・Navara 実証 | 🚧 進行中 |
| Phase 1 | KML/KMZ→3エンジン表示→保存の基本経路 | 未着手 |
| Phase 2 | NetworkLink・Update・Region・時間 | 未着手 |
| Phase 3 | PhotoOverlay・Model・Tour・KML 2.3 全仕様 | 未着手 |
| Phase 4 | Earth Pro 製品機能・歴代機能 | 未着手 |
| Phase 5 | 性能・機種差・配布整備 | 未着手 |

## データソース・ライセンス / Data Sources & Licenses

- ベースマップ: [OpenFreeMap](https://openfreemap.org/) — ODbL
- 地図エンジン: [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) — BSD-3-Clause
- 3D エンジン: [Navara](https://github.com/maplibre/navara) — MIT/Apache-2.0
- 3D サブエンジン: [CesiumJS](https://cesium.com/platform/cesiumjs/) — Apache-2.0
- ソースコード: [Apache-2.0](LICENSE)

## 著者 / Author

Taichi FURUHASHI ([@mapconcierge](https://github.com/mapconcierge))  
青山学院大学 地球社会共生学部 古橋研究室

## 関連リンク / Related Links

- [OGC KML 2.3 仕様](https://docs.ogc.org/is/12-007r2/12-007r2.html)
- [Navara ドキュメント](https://navara.world/docs/)
- [技術設計書](docs/digital-earth-technical-design.md)
