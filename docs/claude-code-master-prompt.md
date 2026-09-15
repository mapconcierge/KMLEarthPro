# Claude Code 指示書：Digital Earth Browser

作成日：2026-09-15。以下を実装プロジェクトの要求仕様・実行指示として扱ってください。製品名は "KML Earth Pro" です。

## 1. 役割・成果目標

あなたは地理空間ソフトウェア、KML、WebGL、ブラウザ性能、アクセシビリティに精通した開発者です。Google Earth Pro の代替となる OSS の Web 版 Digital Earth Browser を実装してください。

最優先は **OGC KML 2.3 の全機能について、読み込み・意味解釈・動的実行・表示・保存を正しく実装すること**です。Google Earth Pro の KML/KMZ 互換と使い勝手を追求し、3D Model は COLLADA、glTF 2.0、GLB を扱います。

これは長期の開発目標です。最初の動作例や部分対応版を完成扱いにせず、各機能の根拠・実装・試験・残課題を台帳に残してください。段階開発は実装順序であり、最終要件を削減するものではありません。

固定要件：

- 既定の 3D は Navara。設定で CesiumJS に切り替え可能。
- 2D は MapLibre GL JS。3D と同じデータ・選択・時間・編集履歴を共有。
- 操作の既定は Google Earth Pro 互換。各エンジン標準操作も選択可能。
- モダンなPC用デスクトップウェブブラウザで動作。対象ブラウザ・バージョン・必要 GPU 機能を実測して明記。
- GitHub Pages から静的配信できる。アプリの必須サーバー、必須有料サービス、必須 API キーを設けない。
- 性能改善のために KML の情報や表示意味を黙って捨てない。
- ソース、ビルド方法、試験、機能対応表、サンプル、ライセンス表記を公開できる構成。

## 2. 最初に参照する資料

各資料について調査日、採用バージョン、コミットまたは配布物ハッシュを記録し、実装時点で再確認してください。紹介記事のコードより、採用バージョンの公式ソース・型定義・仕様を優先します。

- [OGC KML の入口](https://www.ogc.org/standards/kml/)
- [OGC KML 2.3 本文：12-007r2](https://docs.ogc.org/is/12-007r2/12-007r2.html)
- [OGC KML 2.3 Abstract Test Suite：14-068r2](https://docs.ogc.org/ts/14-068r2/14-068r2.html)
- [OGC 公式スキーマ配布](https://schemas.opengis.net/kml/)
- [OGC 実行可能試験実装](https://github.com/opengeospatial/ets-kml2)
- [Google KML Reference](https://developers.google.com/kml/documentation/kmlreference)
- [Google KML Regions](https://developers.google.com/kml/documentation/regions)
- [Google KML 時間表現](https://developers.google.com/kml/documentation/time)
- [Google KMZ](https://developers.google.com/kml/documentation/kmzarchives)
- [Google Earth ヘルプ](https://support.google.com/earth/)
- [Navara ソース](https://github.com/maplibre/navara)
- [Navara 公式サイト](https://navara.world/)
- [CesiumJS](https://cesium.com/platform/cesiumjs/)
- [Cesium KmlDataSource](https://cesium.com/learn/cesiumjs/ref-doc/KmlDataSource.html)
- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Navara 紹介記事：背景資料](https://note.com/ai_driven/n/n67e63466eb01)

Navara リポジトリに同梱された [navara-usage の SKILL.md](https://github.com/maplibre/navara/blob/main/skills/navara-usage/SKILL.md) と関連例を、採用コミットに固定して読んで利用してください。存在しないパッケージ名や API を推測で書かないでください。

## 3. KML 2.3 を取り違えないこと

KML 2.3 は名前空間が `http://www.opengis.net/kml/2.2` のままです。2.3 の機能を含む出力には、仕様に従いルートの `version="2.3.0"` を設定してください。

Tour、Track、MultiTrack、LatLonQuad などの標準化済み要素を、すべて Google 独自拡張と扱わないでください。OGC 標準の表記と既存ファイルの `gx:` 表記を区別して読み、意味の対応が確認できたものを共通モデルへ正規化します。接頭辞文字列ではなく名前空間 URI と local name で判定します。外部名前空間、未知の要素・属性は保持します。

KML 2.3 本文、XSD 1.1、ATS、Google 実装に不一致がある場合は、再現例と根拠を記録して解決してください。Google Earth Pro の表示だけを OGC 2.3 の正解にしません。標準モードと互換モードを必要に応じて分けます。

2.3 で順序制約が緩和された箇所を受理しつつ、Playlist、Update 操作列、Track の時刻・座標・角度・属性配列の意味上の順序は保持します。通常の文書と Update 内の断片では、必須内容や検証条件を分けてください。`gx:` を機械的に除去して標準要素へ変換しません。

## 4. 全機能の台帳を先に作る

`docs/kml-conformance.csv` と閲覧しやすい対応表を作成してください。公式スキーマの全 element / attribute / type / enumeration / default / assertion と、本文のスキーマに表現されない規則、ATS を照合して漏れを検出します。下のリストは作業の分類であり、全要件の代替ではありません。

台帳の列：

`requirement_id, source_url, clause_or_test_id, namespace, element_or_behavior, normative_level, parse, validate, execute, navara_3d, cesium_3d, maplibre_2d, ui_edit, export, fixture_ids, implementation_paths, status, limitation, next_action`

状態は `not-started / implemented-unverified / partial / verified / blocked-external / not-applicable`。未対応・試験未実施・スキップを成功に数えません。`not-applicable` はその操作や表示モードに適用されない根拠がある場合のみ使います。読み込み成功、未知要素保持、2D で位置マーカーを表示できたことを「完全対応」に数えません。

少なくとも次を含めます：

1. XML、KML/KMZ、Document、Folder、Placemark、Feature 共通属性、id/targetId、名前、説明、Snippet、visibility/open、メタデータ、Atom、住所、電話、ExtendedData、Schema、SchemaData、配列、単位、拡張点。
2. Point、LineString、LinearRing、Polygon、穴、MultiGeometry、Model、Track、MultiTrack。高度、押し出し、地形追従、補間、境界条件。
3. Style、StyleMap、normal/highlight、外部 styleUrl、Icon/Label/Line/Poly/Balloon/ListStyle と全属性。色、透過、描画順、アイコンの基準点、文字・リンク置換、フォルダの表示制御。
4. Camera、LookAt、視野、姿勢、地形との関係、カメラに付随する時間、FlyTo。
5. TimeStamp、TimeSpan、精度の異なる日時、開始または終了未指定の期間、時差、境界、Track 補間、複数トラック、モデル姿勢、時系列属性。
6. NetworkLink、Link/Icon、全 refreshMode / viewRefreshMode、viewFormat/httpQuery、画面・カメラ値の置換、NetworkLinkControl、期限・更新間隔・セッション・表示名・バルーン・flyToView・refreshVisibility。
7. Update、Create、Change、Delete、targetHref、部分更新、ジオメトリ更新、参照整合性。
8. Region、LatLonAltBox、Lod、min/maxLodPixels、fade、継承、日付変更線、極域、全地球範囲。SuperOverlay は Region / NetworkLink / GroundOverlay の協調動作として扱う。
9. GroundOverlay、LatLonBox、LatLonQuad、ScreenOverlay、画面単位・回転・サイズ・アンカー。
10. PhotoOverlay、ViewVolume、ImagePyramid、rectangle/cylinder/sphere、タイル参照、配置、入退場、写真内の視点移動。
11. Tour、Playlist、FlyTo、AnimatedUpdate、TourControl、Wait、SoundCue を含む全標準ツアー要素と属性。再生・一時停止・再開・シーク・停止・カメラと音声と更新の同期。
12. KML 2.3 固有の altitudeOffset、seaFloorAltitudeMode、balloonVisibility、horizFov、配列・単位、更新対象拡張等。正確な一覧を公式 XSD と本文から補完する。
13. Google Earth Pro が扱う追加 `gx:` 拡張。対象版のリリースノート・出力ファイルから確認し、標準化済み要素との二重計上を避ける。

OGC の CL1/CL2/CL3 は KML リソースの適合レベルです。ブラウザの全描画機能が実装できたことや OGC 認証取得を意味すると書かないでください。［根拠：[OGC ATS](https://docs.ogc.org/ts/14-068r2/14-068r2.html)］

## 5. 推奨技術構成

基準案：TypeScript strict、Vite、React、pnpm workspace。UI 状態は Zustand 等の小さなストアで扱い、毎フレームのカメラ・ジオメトリ・GPU データを React の状態に載せません。UI 部品はアクセシブルなものを採用し、Places ツリーを仮想化します。

- Navara：`@navaramap/three`、`@navaramap/three-default-plugin`。`three` と `postprocessing` の peer dependency を照合して固定。
- Cesium：`cesium`。KmlDataSource を共通 KML 実行系の中核にせず、低レベルの描画機能をアダプターから利用。
- MapLibre：`maplibre-gl`。採用版の Worker 配置方法に従う。
- KMZ：`fflate` を候補に、ストリーム処理・遅延展開・サイズ制限・保存を検証。
- XML：`XmlParserPort` を設け、初期候補 `@xmldom/xmldom` の Worker 内解析を適合性の基準実装とする。巨大ファイル用ストリーム解析は `sax-wasm` 等を比較し、厳密な XML/名前空間処理を含む同一試験に合格してから導入。パーサの採否を性能だけで決めない。
- 形状：TypedArray、空間索引、必要に応じた三角形分割・測地計算。earcut や rbush/flatbush は候補であり、地理座標のまま単純平面処理して正しいと仮定しない。
- モデル：Three.js の ColladaLoader / GLTFLoader / GLTFExporter を評価し、不足を補うモデル処理層。
- 保存：IndexedDB。大きなローカルデータは OPFS を機能検出して利用可能にする。通常の File/Blob 読み込みとダウンロード保存を全対象ブラウザの基本経路とする。
- バックグラウンド処理：Web Workers、Transferable、Fetch + AbortController。追加 Rust/WASM は計測で効果を示せた箇所に採用。
- 検証：Vitest、Playwright、画像差分、適合試験、必要箇所のプロパティテスト、XSD 1.1 対応検証器。
- CI/公開：GitHub Actions、GitHub Pages。

バージョン番号を記憶から埋めないでください。現行の安定版と互換性を調べ、依存関係をロックします。Navara はベータ版の API 変更リスクをアダプター内に閉じ込めます。

新規プロジェクト本体のライセンスは Apache-2.0 を第一案とします。既存リポジトリのライセンスがあれば維持して適合を確認し、依存ライブラリ・モデル・フォント・画像・地形それぞれの利用条件と著作権表示を別に管理します。LICENSE、NOTICE、依存一覧とデータ出典を整備してください。

## 6. アーキテクチャ

依存方向を次に固定します。

```text
UI / 操作コマンド / 編集履歴
             ↓
DocumentStore + KML Semantic Runtime
  ├─ XmlParser / Validator / Serializer
  ├─ ResourceResolver / KMZ 仮想ファイルシステム
  ├─ StyleResolver / VisibilityEvaluator
  ├─ Timeline / TourPlayer / NetworkLinkScheduler / UpdateEngine
  ├─ RegionEvaluator / Terrain・Geoid / GeometryCompiler
  └─ 中立的な RenderPlan / SceneDelta
             ↓
RendererPort
  ├─ NavaraAdapter（既定）
  ├─ CesiumAdapter
  └─ MapLibre2DAdapter
```

原本は名前空間、要素順、未知拡張、相対参照、明示値と既定値の区別を保持する KML 文書モデルです。原本バイト列と参照位置を保持する方法も検討し、巨大 XML の原本・DOM・AST・GeoJSON を無制限に重複保持しません。GeoJSON は 2D 等への派生表現に限定します。

KML core は Navara/Cesium/MapLibre/React を import しません。共通モデルに THREE.Object3D や Cesium.Entity を入れません。モデル・形状・テクスチャは中立的なハンドルと数値データで参照します。

RendererPort が担う契約：

- 初期化、機能能力の通知、破棄、描画要求、コンテキスト喪失からの復旧。
- カメラ状態の取得・適用、投影情報、画面と地理座標の変換、地表・オブジェクトの picking。
- 差分適用、削除、可視性・スタイル・時間の更新、地形問い合わせ。
- 画面オーバーレイ・バルーンとの同期、キャプチャ、性能情報。
- ネイティブ入力ハンドラの有効化・無効化。

各能力に native / custom / degraded / unavailable の状態と根拠を持たせます。共通機能の不足は custom 実装で補い、少ない機能に合わせて共通モデルを削りません。

切り替え時は同じ KML を再パースせず、文書、選択、可視性、時刻、ツアー状態、編集履歴、カメラを引き継ぎます。原則として 3D エンジンは一つだけ稼働させ、動的 import で読み込みます。元の文書モデル・データキャッシュを維持しながら GPU リソースを解放します。

2D では 3D と同一の視点や奥行きを表現できない場合があります。3D カメラを別保存し、平面へ投影した位置・範囲を表示します。モデルは位置・形状投影、PhotoOverlay は入口と専用ビュー、3D ツアーは対応する動作を定義し、2D の縮退表示を3D完全対応の代用にしません。極域を Mercator の緯度制限で失わないよう、採用版の投影能力を調べて代替投影・専用ビューを設計します。

## 7. 精度・描画意味

- KML 座標の経度・緯度・高度と単位を正しく扱う。WGS84、ECEF、局所 ENU、画面座標の変換を共通化する。
- KML の EGM96 ジオイド基準の正高 H と各エンジンの楕円体高 h を混同しない。ジオイド高 N による h = H + N の変換、および地表・海底相対モードの基準を定義し、必要なデータをプロバイダーから取得する。データ不足を高度ゼロで黙って置換しない。
- 日付変更線、極、全地球、高高度、地表付近、穴のあるポリゴン、押し出し、線の補間、テッセレーションを試験する。
- KML の `aabbggrr` 色表現、透明度、アンカー、回転、描画順、normal/highlight、スタイル参照・上書き規則を検証する。一般的な CSS 継承を当てはめない。
- CPU 側は必要な倍精度を保持し、GPU へは局所原点・相対座標等で精度を確保する。地球規模の座標を単純な Float32 に落とさない。
- Region は地物自身に指定されたもの、なければ最も近い祖先のものを有効 Region とする。祖先 Feature の visibility や、親 NetworkLink の取得条件は別に評価し、祖先の全 Region を機械的に AND しない。LOD は仕様の画面投影面積の平方根に基づき、エンジンのズーム番号を minLodPixels に直接対応づけない。CSS pixel / device pixel、傾き、日付変更線、maxLodPixels=-1、fade 境界を試験する。

## 8. NetworkLink・リソース・時間を一つの実行系で管理する

ResourceResolver で HTTP(S)、インポートファイル、KMZ 内パス、モデルからの相対参照、外部スタイルを一元解決します。原 URL、リダイレクト後 URL、文書 URL、アーカイブ内パス、フラグメントを区別し、文書ごとの id スコープを持ちます。

NetworkLinkScheduler は取得の重複排除、進行中リクエスト共有、優先度、並列上限、キャンセル、リトライ、循環・過深参照の検出、HTTP キャッシュ情報を扱います。onInterval/onExpire と onStop/onRequest/onRegion 等をそれぞれ仕様どおり実装し、UI 側タイマーの寄せ集めにしません。viewFormat/httpQuery による URL 生成を単体試験します。

NetworkLinkControl と Update は原本への差分として適用し、順序・対象 id・作成/変更/削除・部分値指定・スタイル依存関係を維持します。キャッシュ済み結果が後から届いて新しい文書を上書きする競合を防ぎます。ネットワーク更新とローカル編集の競合方針を明文化します。

時計は以下を区別します：取得期限等の実時間、KML 表示時刻、ツアー再生時間、音声再生時間。ツアーをシークしただけで HTTP 更新期限を飛ばさないようにします。

TimeStamp/TimeSpan は文字列を一律に JavaScript Date へ変換して精度を消さないでください。原表現・時間精度・時差・片側未指定を保持し、仕様に基づく表示区間を計算します。時間変更は空間索引・時間索引を使って差分更新します。

Track の時刻・位置・角度・属性配列の対応、欠測、補間、座標の区切り形式を検証します。Track 内 Model の位置・高度は Track から求め、通常配置用 Location 等を二重適用しません。Model Orientation と Track angles の合成順を仕様に照合し、COLLADA と glTF で同じ配置・姿勢になることを試験します。

通常の NetworkLink Update と Tour の AnimatedUpdate を分離します。AnimatedUpdate は保存対象文書を変更しない一時適用層で実行し、終了・停止・中断時に解除します。途中で保存しても一時変更を含めず、同時に受信した恒久 Update やユーザー編集は巻き戻しません。

Tour のシークは、チェックポイントと差分再生などで一時適用層まで再現します。FlyTo/Wait/TourControl の直列進行と、SoundCue/AnimatedUpdate の並列実行を区別し、一時停止・再開・シークを同期します。SoundCue はブラウザの音声開始条件に対応し、ユーザー操作で再生を開始できるようにします。画面非表示時や通信切断後の復帰を試験します。［参考：[Google Tours](https://developers.google.com/kml/documentation/touring)、[Google Updates](https://developers.google.com/kml/documentation/updates)］

## 9. Overlay と 3D Model

GroundOverlay は経緯度矩形・回転・四辺形・地形への貼り付け・高度・透過を扱います。ScreenOverlay とバルーンは DOM/Canvas 等の共通実装も利用し、エンジン切り替えで配置を変えません。

PhotoOverlay は単なる画像ポップアップで完了とせず、ViewVolume と各 shape、ImagePyramid のタイル選択、写真へ入る・戻る・写真内を見る操作まで実装します。SuperOverlay は必要範囲を段階取得し、解像度切り替え時の空白や二重描画を防ぎます。

Model は既存 `Model/Link/href` による `.dae`、`.gltf`、`.glb` 参照を基本にします。OGC KML 2.3 のモデル資産対応プロファイルとして、対応 glTF バージョン、必須/任意拡張、リソース探索、座標軸・単位・材質・アニメーション・配置規則を `docs/model-profile.md` に定義します。XML の独自名前空間は追加メタデータ等に必要な場合だけ設けます。［根拠：[OGC ATS ATC-133](https://docs.ogc.org/ts/14-068r2/14-068r2.html)］

- COLLADA の unit/up_axis と KML Location/Orientation/Scale の変換順序を検証する。
- ResourceMap/Alias、KMZ 内テクスチャ、外部相対パス、GLB 内包資産、glTF 外部 buffer/image を共通 resolver で処理する。
- 共通 resolver でも参照の基点は区別する。Alias/sourceHref は元モデル資産を基点とし、Alias/targetHref 等の KML 側参照は包含 KML を基点とする。glTF 自身の buffer/image URI は glTF 資産を基点とし、全 URL を KML 起点に統一しない。
- Navara では Three.js 側のモデル描画、Cesium では glTF 描画を利用する。COLLADA はブラウザ内の読み込み・変換を評価し、エンジン間で外観と配置が一致するか試験する。
- Three.js ColladaLoader は COLLADA 仕様全体を実装していない。Loader→Exporter の変換経路だけで全対応を宣言しない。Google Earth 対象モデル群と KML 要求事項に対する不足を調べ、補完する。
- COLLADA 原本を保存し、表示用に変換した glTF だけを保存対象にしない。ハッシュで変換キャッシュを管理する。
- glTF 専用資産を含む出力と、Google Earth 互換を確認した COLLADA 出力を区別する。glTF→COLLADA の無損失変換を約束しない。

モデル対応の参考：[ColladaLoader の制限](https://threejs.org/docs/pages/ColladaLoader.html)、[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)、[GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html)。

## 10. Google Earth Pro の UI/UX

最初に比較対象の Google Earth Pro の版、OS、表示倍率、入力機器を固定し、`docs/earth-pro-parity.csv` と操作記録を作ります。過去に提供されていた機能も台帳に残し、現行・廃止・外部サービス依存を区別します。歴代の全機能を対象にするための差分調査を実施し、記憶で列挙して完了にしません。

基本配置：上部メニューとツールバー、左の検索・場所・レイヤー、中央地図、右上の方位・傾斜・ズーム、下部の座標・標高・視点高度・スケール・出典、必要時の時間スライダーとツアー操作。

Places ツリーではフォルダ、チェック、並べ替え、ドラッグ移動、プロパティ、保存、検索、右クリック操作、ダブルクリック移動を再現します。KML の ListStyle による振る舞いも反映します。作図・モデル配置・画像配置・スタイル編集・時刻設定・Undo/Redo・KML/KMZ 出力を実装します。高度な要素も少なくとも原本を保持したプロパティ編集または構造編集を可能にし、編集保存で脱落させません。

`EarthProNavigationController` を共通層で実装します。Earth Pro モードでは各ライブラリの入力ハンドラを停止し、同一のカメラ移動指令をアダプターに渡します。ジェスチャーだけでなく、注視点、地表の掴み方、回転中心、ズーム目標、慣性、衝突回避、自動傾斜、FlyTo の軌道を調整します。

初期の操作項目：左ドラッグの移動、ホイールズーム、中ボタンと修飾キーを使う傾斜・回転、右ドラッグズーム、ダブルクリック移動、N/U/R と停止操作。Windows/Linux と macOS、マウスとトラックパッド、自然スクロール、OS とブラウザが予約するショートカットを別試験し、正確な割り当てを公式資料と対象版実機で確定します。

設定項目：

- 3D エンジン：Navara / CesiumJS。
- 入力：Earth Pro 互換 / 現在のエンジン標準 / カスタム。
- 「エンジン標準」は現在稼働しているエンジンの標準入力を再有効化する。対象名を表示し、Navara・Cesium・MapLibre それぞれの設定を保持する。
- 感度、慣性、ホイール反転、ズーム時の自動傾斜、修飾キー、品質、地形、データソース、キャッシュ、単位、座標表記、言語。
- 操作プリセットを切り替えても二重イベント処理やカメラの跳躍が起きない。

追加の製品機能として、計測、面積、標高断面、可視領域・見通し分析、検索、経路、GPS/GPX/CSV/Shapefile/MapInfo/GeoTIFF/GeoJSON 等の読み込み、画像保存・印刷、ツアー録画・動画書き出し、履歴画像、日照、海底、Street View 相当、Sky/Moon/Mars、フライト機能、外部機器連携を対象版・歴代機能表で確認し、実装順・データ要件・ブラウザ制約を記載します。KML 標準機能の完了を優先し、他機能の未実装を隠しません。

操作と対象機能の基準資料は [Google ショートカット](https://support.google.com/earth/answer/148115?hl=en)、[マウス操作](https://support.google.com/earth/answer/148186?hl=en)、[Earth Pro リリースノート](https://support.google.com/earth/answer/40901?hl=en) とします。現行版の追加拡張（例：gx:CascadingStyle）も棚卸しし、ヘルプ内の旧版・Web 版との混在を確認します。

画面は英語を既定とし日本語も用意する案で進めます。独自名称・アイコン・配色を用い、Google のブランドやアセットを流用せず、配置と操作の親和性を高めます。キーボード操作、フォーカス、スクリーンリーダー、拡大表示、色覚差に対応します。

## 11. 静的配信とデータ依存

GitHub Pages はアプリ本体と小規模サンプルを配信する場所です。全球画像・地形・3D 都市データをアプリと一緒に大量配置せず、差し替え可能な `ImageryProvider / TerrainProvider / BathymetryProvider / GeoidProvider / Geocoder / RouteProvider / HistoricalImageryProvider / PanoramaProvider` を用意します。

最小起動はキーなしで成立させ、小さな同梱地図・サンプルを利用可能にします。画像や地形がない状態でも原因が分かるようにし、データ利用条件・出典・精度・利用範囲・更新日を表示します。PMTiles 等は任意の静的データ配信方式として評価し、必要な HTTP Range/CORS が実際に動くか確認します。

Google 独自の画像、履歴、写真、検索等を、そのまま使える API や再配布可能データと仮定しません。対応する操作機能は維持し、利用可能な供給元を接続する設計にします。

外部 NetworkLink は HTTPS、CORS、認証、アクセス元制限等に従います。CORS 未許可の URL を通常のブラウザコードで読めるようにすることはできません。`no-cors`、Service Worker、ブラウザ設定変更を回避策にしません。

純静的モードは許可された URL とユーザーが選択したローカル資産を扱います。別途、ユーザーが管理する任意プロキシ/ローカル companion の接続口を設計できますが、必須依存にはしません。HTTP-only、認証付きリソース、デスクトップの任意パス・ライブ機器連携などに必要な場合は、機能台帳に前提条件を明記します。公開された無制限プロキシは用意しません。

Pages では `base` をリポジトリサブパスに対応させ、必要に応じて hash routing を使います。Navara の WASM/Worker、Cesium の Workers/Assets/Widgets/ThirdParty、MapLibre の Worker と CSS、モデルデコーダーを採用バージョンに合わせて配信します。開発サーバーだけで成功とせず、実配信相当のサブパスで MIME・URL・リロードを確認します。

SharedArrayBuffer、WASM threads、cross-origin isolation を必須にしません。通常 Worker と Transferable の経路を必ず用意します。Navara 採用版でこの条件が成り立つか最初に検証し、必須だった場合は代替ビルドやアダプター改修を調べ、解決できなければ「Navara 既定＋素の Pages」の阻害要因として報告してください。WebGPU も初期必須要件にしません。

［配信根拠：[Vite の Pages 配信](https://vite.dev/guide/static-deploy.html#github-pages)、[Pages 上限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)、[crossOriginIsolated](https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated)］

## 12. 性能設計

優先順位は正しい表示意味、操作応答性、メモリ上限、描画速度、初回取得量です。

1. KMZ 展開、XML 解析、形状生成、空間・時間索引、可能なモデル変換を Worker に移す。DOM/Image/Canvas 前提のライブラリは Worker 対応と決めつけず、必要部分を分離する。
2. 読み込みをキャンセル可能にし、巨大データを段階表示する。画面範囲と Region/LOD に基づいて取得・処理する。
3. グローバルな並列処理予算を設け、Navara 内蔵 Workers とアプリ Workers の過剰生成を防ぐ。
4. TypedArray と Transferable、差分、インスタンシング、バッチ描画、テクスチャ共有を使う。KML のスタイル・描画順を壊す結合や、意味を失う自動簡略化をしない。
5. タイル・モデル・テクスチャの LRU、メモリ予算、Object URL と GPU リソースの破棄、IndexedDB キャッシュ期限を管理する。
6. 変化がない時は描画を抑える。Cesium の requestRenderMode 等を利用し、時刻・ツアー・点滅・アニメーションが動く時は必要な描画を続ける。Navara も実 API で可能な方法を検証する。
7. 動的 import、遅延ロード、初期データの軽量化を行う。2D モードで未使用の3Dエンジンを起動しない。
8. ドラッグ中は画質を調整し、静止後に改善する。意味に影響するラベル省略やクラスタ化等は選択可能な表示方針として扱う。

計測条件を `docs/performance.md` に固定します。CPU/GPU/メモリ、OS、ブラウザ、viewport、DPR、ネットワーク、冷/温キャッシュ、ファイルの実バイト数・頂点数・テクスチャ量を記載します。

暫定目標は、基準 PC・1080p・通常操作時に p95 フレーム時間 33ms 以下、UI 操作 p95 100ms 以下、段階読み込み時に進捗・キャンセルが応答することです。これは達成済み性能でも全端末保証でもありません。初期計測からデータ規模別に予算を固定し、変更時は理由と比較結果を残します。

ベンチマークは 1万/10万点、100万座標を含む線・面、深い Places ツリー、数千タイル相当の SuperOverlay、複数 NetworkLink と Update、複数モデル、ツアー、エンジン切り替え反復を含めます。FPS だけでなく、初回可視化時間、全準備時間、入力遅延、Long Task、取得数、転送量、メモリ、長時間動作・切替後の解放を測ります。

## 13. ファイルと外部コンテンツの安全な処理

KML description / Balloon の HTML は許可した要素・属性を維持してサニタイズし、必要に応じて sandboxed iframe に表示します。JavaScript、イベント属性、実行可能 URL 等は実行しません。除去が表示に影響したら理由を表示します。

XML の外部エンティティ・DTD を自動取得しません。KMZ のパス脱出、極端な展開率・ファイル数、無限参照、巨大画像やモデルに上限と明瞭な診断を設けます。ブラウザの制約や安全上の制限を「KML 仕様未対応」と混ぜず、適合台帳に扱いを記録します。

外部資産取得にアプリの秘密鍵を埋め込みません。ユーザーのデータを明示的な操作なしにサーバーへ送らず、認証付き応答を公開キャッシュへ保存しません。

## 14. 試験と完了判定

試験を四層で用意してください。

### A. 文書・仕様

全要件に正常・異常・境界の fixture を対応づけます。OGC 公式 XSD と依存スキーマを出典・ハッシュつきで固定し、XSD 1.1 対応検証器を用います。Python `xmlschema.XMLSchema11` または OGC ETS は候補です。実際の KML スキーマを読ませて確認してから採用し、XSD 1.0 のみの検証器で代用しません。［参考：[XMLSchema11](https://xmlschema.readthedocs.io/en/latest/features.html#xsd-1-0-and-1-1-support)］

スキーマ検証に加え、意味規則、更新規則、KML→保存→再読込の意味的同等性、未知拡張保持を検証します。XML がバイト単位で同じことと意味が同じことを区別します。

### B. 共通実行系

決定的な時計・カメラ・地形・ネットワークを使い、NetworkLink の全更新条件、Region 境界、時間境界、Tour シーク、Update と参照解決、キャンセル・通信競合を試験します。外部サービスの常時稼働に依存しない fixture server を CI 用に用意します。CI 用サーバーは製品の必須サーバーではありません。

### C. 表示・操作

同じ fixture を Navara と Cesium で実行し、2D は定義した投影結果を検証します。地形・画像・光源・時計・フォントを固定して画像差分と数値測定を併用します。対象版 Google Earth Pro との手動比較は再現手順と観測を保存し、未実施なら明記します。

地図操作、ツリー操作、PhotoOverlay への入退場、モデルの姿勢、バルーン、編集と Undo/Redo、保存、エンジン切り替え、時刻の引き継ぎを Playwright 等で試験します。

### D. 配信・長時間・障害

Pages 相当のサブパス、実ブラウザ、オフライン、CORS 不許可、404、タイムアウト、期限切れ、破損 KMZ、モデル資産欠落、GPU コンテキスト喪失、メモリ上限、長時間更新、切替反復を試験します。ヘッドレス試験だけで GPU の互換性を保証しません。

最終完了の条件：

- OGC KML 2.3 の要求台帳に漏れがなく、適用する全項目が実装・検証済み。
- Navara/Cesium それぞれの3D表示で要求する機能を検証。MapLibre の2D表現と差異を公開。
- COLLADA と glTF/GLB のプロファイルおよび fixtures が合格。
- Google Earth Pro 互換機能の対象版・歴代調査・残課題が明確。製品全機能の完了と KML 完了を別判定。
- 性能目標、保存往復、操作試験、静的配信を検証。
- blocked-external や partial が残る機能を含めて「完全互換」「全機能完了」と宣伝しない。

## 15. 推奨リポジトリ構成

```text
apps/web/
packages/kml-core/
packages/kml-runtime/
packages/resource-resolver/
packages/geo-math/
packages/model-pipeline/
packages/renderer-contract/
packages/renderer-navara/
packages/renderer-cesium/
packages/renderer-maplibre/
packages/navigation/
packages/test-fixtures/
tests/conformance/
tests/integration/
tests/visual/
tests/performance/
docs/adr/
docs/kml-conformance.csv
docs/earth-pro-parity.csv
docs/model-profile.md
docs/performance.md
docs/deployment.md
docs/status.md
CLAUDE.md
```

小さな package を無意味に増やさず、上記の責務境界が検査できれば統合して構いません。`CLAUDE.md` には固定要件、実行コマンド、設計原則、現在フェーズ、継続方法を簡潔に保存します。

## 16. 実装順序

### Phase 0：仕様棚卸しと重大な技術条件の実証

KML 台帳の全スキーマ項目、本文照合の計画、Google Earth 機能台帳、採用依存一覧、設計判断を作成します。Navara の地球表示・カメラ制御・picking・地形問い合わせ・独自形状・モデル・動的更新・破棄を小さな実証で確認します。Cesium/MapLibre の同じ契約、3エンジンの配信資産、Pages サブパス、通常 Worker 経路も確認します。

特に Navara の API・静的配信に阻害要因があれば、再現・代替・必要な改修を提示します。ユーザーの指定を黙って Cesium 既定へ変更しません。

### Phase 1：最初の端から端まで動く実装

KML/KMZ の最小文書モデル、Places ツリー、地物とスタイル、Navara 既定表示、Cesium/MapLibre 切替、Earth Pro 操作、保存往復、最初の適合試験、配信ビルドを実装します。

### Phase 2：動的 KML の中核

全スタイル、視点、高度、NetworkLink、NetworkLinkControl、Update、Region、時間、SuperOverlay を実装します。最難関の PhotoOverlay・COLLADA・Tour は、この段階以前から技術実証を並行し、最後まで成立性を未確認にしません。

### Phase 3：KML 2.3 全機能の完了

PhotoOverlay、全 Overlay、Model、Track/MultiTrack、Tour、2.3 固有要素、拡張点、全台帳の残項目とクロス機能試験を完成させます。

### Phase 4：Google Earth Pro 製品機能の拡充

作図・編集、計測、標高断面、取り込み、画像/印刷/動画、検索・地形・履歴等のプロバイダー、追加操作、歴代機能差分を台帳に従って実装します。外部サービス・ブラウザに依存する項目は必要条件を具体化します。

### Phase 5：最適化とリリース

全期間で性能を計測し、この段階でデータ規模・長時間・機種差を最終確認します。依存ライセンス、NOTICE、出典、再現可能ビルド、公開対応表、利用説明、Pages 公開手順を整えます。

## 17. 今回の開始指示と継続ルール

まず既存リポジトリを確認し、採用資料と技術条件を調査してください。その後、Phase 0 と Phase 1 の最初の動く縦断実装に着手してください。調査文書だけで終了せず、ビルド・試験可能な成果を残してください。

各作業区切りで、変更、実行した試験と結果、実施していない検証、性能への影響、台帳の更新、次の最小作業を報告します。時間やコンテキストの制限に達したら、`docs/status.md` に次の担当が続けられる具体的状態を残します。失敗した試験を削除・スキップして完了扱いにせず、依存ライブラリの不足を製品要件の削除で解決しません。

初期成果のレビューが可能になった時点で、固定要件の達成見込み、最大の未解決事項、必要な設計判断をまとめてください。以後は同じ仕様と台帳を引き継いで、次フェーズを実装・検証してください。
