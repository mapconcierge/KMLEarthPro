export interface MvtStyle {
  fillStyle?: string
  strokeStyle?: string
  lineWidth?: number
}

export interface VectorLayerSpec {
  /** OpenMapTiles のソースレイヤー名 */
  sourceLayer: string
  /** このズーム以上で描画する。地球儀表示で全世界の地物を描かせないための下限 */
  minZoom: number
  style: (properties: Record<string, unknown>) => MvtStyle
}

const LANDCOVER_FILL: Record<string, string> = {
  wood: '#8fae74',
  grass: '#b3cf95',
  farmland: '#d4d8a0',
  ice: '#f0f4f8',
  rock: '#b8b2a8',
  sand: '#e4d9b8',
  wetland: '#9fc0ad',
}

// タイル内は 256px 固定なので、線幅は種別の主従が分かる程度に留める
const ROAD_STYLE: Record<string, MvtStyle> = {
  motorway: { strokeStyle: '#e0955e', lineWidth: 1.8 },
  trunk: { strokeStyle: '#e8a86f', lineWidth: 1.5 },
  primary: { strokeStyle: '#efc276', lineWidth: 1.3 },
  secondary: { strokeStyle: '#ead9a8', lineWidth: 1 },
  tertiary: { strokeStyle: '#ded6c2', lineWidth: 0.8 },
  minor: { strokeStyle: '#d5cec0', lineWidth: 0.5 },
  rail: { strokeStyle: '#b0a8a0', lineWidth: 0.5 },
}

/** 定義順がそのまま描画順になる（後のものが上に乗る） */
export const VECTOR_LAYERS: VectorLayerSpec[] = [
  {
    sourceLayer: 'landcover',
    minZoom: 4,
    style: (p) => ({ fillStyle: LANDCOVER_FILL[String(p['class'])] }),
  },
  { sourceLayer: 'water', minZoom: 2, style: () => ({ fillStyle: '#7fb0dc' }) },
  {
    sourceLayer: 'waterway',
    minZoom: 8,
    style: () => ({ strokeStyle: '#7fb0dc', lineWidth: 0.8 }),
  },
  {
    sourceLayer: 'transportation',
    minZoom: 7,
    style: (p) => ROAD_STYLE[String(p['class'])] ?? {},
  },
  {
    sourceLayer: 'boundary',
    minZoom: 2,
    style: (p) =>
      Number(p['admin_level']) <= 2
        ? { strokeStyle: '#8f7a9c', lineWidth: 1 }
        : { strokeStyle: '#b9a6c2', lineWidth: 0.5 },
  },
  { sourceLayer: 'building', minZoom: 13, style: () => ({ fillStyle: '#c9bfb2' }) },
]
