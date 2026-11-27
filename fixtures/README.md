# fixtures — KML の検証用データと XSD

KML/KMZ の読み込み・保存が仕様に沿っているかを確かめるためのデータです。

## 構成

| パス | 内容 | 期待 |
|---|---|---|
| `kml/valid/` | 仕様に適合する KML（点・線・面・MultiGeometry・スタイル・視点・フォルダ・日本語・CDATA・visibility/description の順序） | XSD に適合し、意味検査で指摘なし。シリアライザの出力も適合し、往復で文書モデルが変わらない |
| `kml/invalid/` | XSD に不適合な KML（列挙値外・未知の要素・数値でない値・id 重複・要素の順序違反） | XSD で不適合 |
| `kml/semantic/` | XSD には適合するが、仕様上の制約に反する KML。ファイル名の先頭が検出されるべき規則 ID | `src/kml/validate.ts` が規則 ID を検出 |
| `schemas/` | 検証に使う XSD（出典は下記） | — |

## 実行

```sh
pnpm test                                  # tests/ 以下（XSD・意味検査・シリアライザの適合）を含む全テスト
pnpm validate:kml path/to/file.kml ...     # 任意の KML を XSD で検証（NG のとき終了コード 1）
```

## 何を、どこまで検証しているか（できていないことも含む）

- **XSD は KML 2.2 の `ogckml22.xsd`** を使っています。KML 2.3 は 2.2 と同じ名前空間（`http://www.opengis.net/kml/2.2`）ですが、
  2.3 の `ogckml23.xsd` は XSD 1.1（`defaultOpenContent` など）で書かれており、libxml2（xmllint-wasm）は XSD 1.0 までしか
  読めないため、2.3 の XSD では検証できていません（実際に読み込みを試して失敗を確認済み）。
  そのため **KML 2.3 で追加された要素（`altitudeOffset` など）や `gx:` 拡張は XSD では検証されません**。
- **ATS（OGC 14-068, KML 2.3 Abstract Test Suite）は実装していません。** 本文を入手できず（`docs.ogc.org` で 404）、
  テスト項目を確認できていないためです。代わりに `src/kml/validate.ts` に、OGC 12-007r2 本文の "shall" の記述を根拠にした
  一部の規則（`KML-V001`〜`KML-V008`）を実装しています。うち V007・V008（LinearRing の閉合と点数、LineString の点数）は
  出典を確認できていないため warning です。規則 ID は ATS のテスト番号ではありません。
- KMZ（ZIP 構造）の検証は未実装です。
- XML の well-formed は DOMParser の結果に依存します。

## 出典・ライセンス

`schemas/` の XSD は OGC が配布するものです（取得元: `https://schemas.opengis.net/kml/2.2.0/`）。

- `ogckml22.xsd`: Copyright (c) 2008 Open Geospatial Consortium。**変更点は 1 箇所のみ**:
  `xAL.xsd` の `schemaLocation` を、オフラインで検証できるよう `http://docs.oasis-open.org/election/external/xAL.xsd` から相対パス `xAL.xsd` へ書き換え。
- `atom-author-link.xsd`: 同上（無変更）。
- `xAL.xsd`: OASIS CIQ（`http://docs.oasis-open.org/election/external/xAL.xsd`）。無変更。

OGC のスキーマは OGC の利用条件（https://www.ogc.org/about-ogc/policies/ ）に従います。本リポジトリのコード・fixture（CC0）とは別の著作物です。
