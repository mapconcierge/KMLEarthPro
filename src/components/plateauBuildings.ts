/**
 * PLATEAU（国土交通省）の建築物モデル 3D Tiles。東京 23 区、2025 年版の
 * 各区で利用可能な最高 LOD を採用している。
 *
 * URL は G 空間情報センターのデータカタログ API から取得した実体を固定している。
 * 更新時は下記から同条件で取り直す:
 *   https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets
 *   datasets[] から type='建築物モデル' / pref='東京都' / format='3D Tiles' を抽出し、
 *   区ごとに (year, lod) が最大のものを選ぶ
 */
export const PLATEAU_BUILDINGS: [ward: string, tilesetUrl: string][] = [
  ['千代田区', 'https://assets.cms.plateau.reearth.io/assets/28/07d0a1-b6be-46ef-bd87-4f0683b5ef6e/13101_chiyoda-ku_pref_2025_citygml_1_op_bldg_3dtiles_13101_chiyoda-ku_lod2/tileset.json'],
  ['中央区', 'https://assets.cms.plateau.reearth.io/assets/09/83a3f6-6605-477c-84dc-a973008b5a27/13102_chuo-ku_pref_2025_citygml_1_op_bldg_3dtiles_13102_chuo-ku_lod2/tileset.json'],
  ['港区', 'https://assets.cms.plateau.reearth.io/assets/c7/ffcc73-1d33-434b-a49a-aa0289160814/13103_minato-ku_pref_2025_citygml_1_op_bldg_3dtiles_13103_minato-ku_lod3/tileset.json'],
  ['新宿区', 'https://assets.cms.plateau.reearth.io/assets/00/bed0bd-f882-4cde-b942-21d0f8d2ddc2/13104_shinjuku-ku_pref_2025_citygml_1_op_bldg_3dtiles_13104_shinjuku-ku_lod2/tileset.json'],
  ['文京区', 'https://assets.cms.plateau.reearth.io/assets/c6/c5c89a-859d-4dce-8e25-04e02a39b270/13105_bunkyo-ku_pref_2025_citygml_1_op_bldg_3dtiles_13105_bunkyo-ku_lod2/tileset.json'],
  ['台東区', 'https://assets.cms.plateau.reearth.io/assets/8b/17cb7e-3e1f-4738-81ce-c944ca73a161/13106_taito-ku_city_2025_citygml_1_op_bldg_3dtiles_lod4/tileset.json'],
  ['墨田区', 'https://assets.cms.plateau.reearth.io/assets/f2/aaaf35-d94c-4c15-affd-d9f652cd16c1/13107_sumida-ku_pref_2025_citygml_1_op_bldg_3dtiles_13107_sumida-ku_lod3/tileset.json'],
  ['江東区', 'https://assets.cms.plateau.reearth.io/assets/80/e01efb-831d-4752-a10e-63b407ee2201/13108_koto-ku_pref_2025_citygml_1_op_bldg_3dtiles_13108_koto-ku_lod2/tileset.json'],
  ['品川区', 'https://assets.cms.plateau.reearth.io/assets/e3/6b15f6-43f5-442f-abb8-dea27f5b16c3/13109_shinagawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13109_shinagawa-ku_lod2/tileset.json'],
  ['目黒区', 'https://assets.cms.plateau.reearth.io/assets/66/f1f857-965f-4850-827e-4d7aae84d879/13110_meguro-ku_pref_2025_citygml_1_op_bldg_3dtiles_13110_meguro-ku_lod2/tileset.json'],
  ['大田区', 'https://assets.cms.plateau.reearth.io/assets/a9/ea2016-3ecc-4dc4-84f8-488b13f2816b/13111_ota-ku_pref_2025_citygml_1_op_bldg_3dtiles_13111_ota-ku_lod2/tileset.json'],
  ['世田谷区', 'https://assets.cms.plateau.reearth.io/assets/bc/1c2533-8fb5-4b1b-a6fc-37caa55b3f53/13112_setagaya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13112_setagaya-ku_lod2/tileset.json'],
  ['渋谷区', 'https://assets.cms.plateau.reearth.io/assets/16/b016d3-42ef-4428-ad99-d229310b39fd/13113_shibuya-ku_pref_2025_citygml_1_op_bldg_3dtiles_13113_shibuya-ku_lod2/tileset.json'],
  ['中野区', 'https://assets.cms.plateau.reearth.io/assets/69/c68a38-eae5-4a70-b981-497109b3e7f7/13114_nakano-ku_pref_2025_citygml_1_op_bldg_3dtiles_13114_nakano-ku_lod2/tileset.json'],
  ['杉並区', 'https://assets.cms.plateau.reearth.io/assets/df/8baea0-cf08-472e-a3fe-ae42aa939560/13115_suginami-ku_city_2025_citygml_1_op_bldg_3dtiles_13115_suginami-ku_lod2/tileset.json'],
  ['豊島区', 'https://assets.cms.plateau.reearth.io/assets/a6/85dfbe-994a-4da4-90fc-ec7f4661d469/13116_toshima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13116_toshima-ku_lod2/tileset.json'],
  ['北区', 'https://assets.cms.plateau.reearth.io/assets/fc/e0156d-7dbe-45a0-a379-0d62ae2348d8/13117_kita-ku_pref_2025_citygml_1_op_bldg_3dtiles_13117_kita-ku_lod2/tileset.json'],
  ['荒川区', 'https://assets.cms.plateau.reearth.io/assets/0f/762e7a-da56-427d-827b-2c9dfc29edab/13118_arakawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13118_arakawa-ku_lod2/tileset.json'],
  ['板橋区', 'https://assets.cms.plateau.reearth.io/assets/17/6b90ce-370e-4787-9c83-4c7905d0d82a/13119_itabashi-ku_pref_2025_citygml_1_op_bldg_3dtiles_13119_itabashi-ku_lod2/tileset.json'],
  ['練馬区', 'https://assets.cms.plateau.reearth.io/assets/1b/b26cf7-16e5-41a8-8867-7e4cccbb9d10/13120_nerima-ku_pref_2025_citygml_1_op_bldg_3dtiles_13120_nerima-ku_lod2/tileset.json'],
  ['足立区', 'https://assets.cms.plateau.reearth.io/assets/07/090a83-e971-41f3-afee-9bddaa166c29/13121_adachi-ku_pref_2025_citygml_1_op_bldg_3dtiles_13121_adachi-ku_lod2/tileset.json'],
  ['葛飾区', 'https://assets.cms.plateau.reearth.io/assets/75/8a1ab9-084d-4d29-9ac9-3591a73267c8/13122_katsushika-ku_pref_2025_citygml_1_op_bldg_3dtiles_13122_katsushika-ku_lod2/tileset.json'],
  ['江戸川区', 'https://assets.cms.plateau.reearth.io/assets/ab/8f247e-adad-49c8-8ead-038bf23c8f00/13123_edogawa-ku_pref_2025_citygml_1_op_bldg_3dtiles_13123_edogawa-ku_lod2/tileset.json'],
]
