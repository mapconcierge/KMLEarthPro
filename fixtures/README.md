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
pnpm validate:kml path/to/file.kml ...     # 任意の KML を KML 2.2 の XSD で検証（libxml2。NG のとき終了コード 1）
pnpm xsd11:setup                           # Xerces-J（XSD 1.1）を .cache/ へ取得（要ネットワーク。初回のみ）
pnpm validate:kml:xsd11 [--schema 2.2|2.3] path/to/file.kml ...   # 任意の KML を XSD 1.1 で検証（既定は KML 2.3 の XSD。要 Java）
```

## 何を、どこまで検証しているか（できていないことも含む）

検証は 2 系統あります。

1. **libxml2（xmllint-wasm）× KML 2.2 の XSD**（`schemas/ogckml22.xsd`）: 常に実行されます。libxml2 は XSD 1.0 までなので 2.3 の XSD は読めません。
2. **Apache Xerces-J 2.12.2（XML Schema 1.1 版）× KML 2.3 の XSD**（`schemas/kml23/ogckml23.xsd`）: Java（JRE 11 以上。javac は不要）が
   あり、`pnpm xsd11:setup` で Xerces を取得済みのときに実行されます。無ければテストはスキップされます。
   Xerces は配布元（archive.apache.org）の SHA-512 で検証してから `.cache/`（Git 管理外）へ展開します。

KML 2.3 の XSD は XSD 1.1 の機能（`defaultOpenContent`、`xs:all` の `maxOccurs` > 1、XPath 2 のアサーション）を使います。
アサーションにより、`balloonVisibility`・`altitudeOffset`・`seaFloorAltitudeMode`・`Tour`・`LatLonQuad` などの **KML 2.3 で追加された要素は、
`<kml version="2.3">` のときだけ適合します**（`kml23/valid` と `kml23/invalid` で確認）。

2.2 と 2.3 の XSD の違いで結果が分かれる fixture があります: `invalid/05-wrong-order.kml`（`name` がジオメトリの後ろ）は、
2.2 の XSD（要素の順序を強制）では不適合、2.3 の XSD（`xs:all`＝順序を問わない）では適合です。`invalid/` の他の 4 件はどちらでも不適合です。

Xerces（2.2 の XSD）と libxml2（2.2 の XSD）が、`valid`・`invalid`・`semantic` の全 fixture で同じ結論になることもテストで確認しています
（独立した 2 つの実装による相互検証）。

- **gx: 拡張**（Google の KML 拡張）の XSD は取り込んでおらず、`gx:` の要素は検証されません。
- **ATS（OGC 14-068, KML 2.3 Abstract Test Suite）は実装していません。** 本文を入手できず（`docs.ogc.org` で 404）、
  テスト項目を確認できていないためです。代わりに `src/kml/validate.ts` に、OGC 12-007r2 本文の "shall" の記述を根拠にした
  一部の規則（`KML-V001`〜`KML-V010`）を実装しています。うち V007〜V010（LinearRing の閉合と点数、LineString の点数、
  LatLonAltBox の南北、Lod の範囲）は出典を確認できていないため warning です。規則 ID は ATS のテスト番号ではありません。
- KMZ（ZIP 構造）の検証は未実装です。
- XML の well-formed は DOMParser の結果に依存します。
- Xerces は、複数ファイルを 1 回の起動で検証すると、別ファイルで同じ `id` を使っただけで「重複」と誤判定します（ID の記録が持ち越されるため）。
  そのためファイルごとに別の JVM で実行しています（並列 4）。

## 出典・ライセンス

`schemas/` の XSD は OGC が配布するものです（取得元: KML 2.2 は `https://schemas.opengis.net/kml/2.2.0/`、KML 2.3 は `https://schemas.opengis.net/kml/2.3/`）。

- `ogckml22.xsd` / `kml23/ogckml23.xsd`: Copyright (c) 2008 / 2015 Open Geospatial Consortium。**変更点はそれぞれ 1 箇所のみ**:
  `xAL.xsd` の `schemaLocation` を、オフラインで検証できるよう `http://docs.oasis-open.org/election/external/xAL.xsd` から相対パス `xAL.xsd` へ書き換え。
- `atom-author-link.xsd`（2.2 用と 2.3 用）: 無変更。
- `xAL.xsd`（`schemas/` と `schemas/kml23/` に同一のもの）: OASIS CIQ（`http://docs.oasis-open.org/election/external/xAL.xsd`）。無変更。

OGC のスキーマは OGC の利用条件（https://www.ogc.org/about-ogc/policies/ ）に従います。本リポジトリのコード・fixture（CC0）とは別の著作物です。

Apache Xerces-J（Apache License 2.0）は、リポジトリには含めず、`pnpm xsd11:setup` が配布元から取得して `.cache/` に置きます。
