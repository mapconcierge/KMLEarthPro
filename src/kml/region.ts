import { childrenOf, type Feature, type KmlDocument, type Region } from './types'
import type { FeaturePath } from './target'

// Region（LatLonAltBox + Lod）による表示切替の判定。エンジンに依存しない純関数。
// 簡略化: 高度（minAltitude / maxAltitude / altitudeMode）は無視し、地図上の範囲だけで判定する。
// フェード（minFadeExtent / maxFadeExtent）は適用しない。日付変更線をまたぐ範囲（west > east）は扱わない。

/** 現在の表示範囲（度）と、描画領域の大きさ（CSS px）。2D の地図の見え方を基準にする */
export interface RegionView {
  west: number
  south: number
  east: number
  north: number
  widthPx: number
  heightPx: number
}

const mercY = (latDeg: number) => {
  const lat = (Math.max(Math.min(latDeg, 85.0511), -85.0511) * Math.PI) / 180
  return Math.log(Math.tan(Math.PI / 4 + lat / 2))
}

/** 範囲が表示範囲と重なるか */
function intersects(b: Region['box'], v: RegionView): boolean {
  return b.west <= v.east && b.east >= v.west && b.south <= v.north && b.north >= v.south
}

/**
 * Region が画面上で占める大きさ（px）。範囲を画面へ投影した矩形の面積の平方根（正方形なら一辺）。
 * 仕様（12-007r2）は Lod を「画面上のピクセルでの計測値」としか定めていない。平方根面積という測り方は
 * Google の KML 資料に基づく解釈。矩形は表示範囲でクリップせず、投影した全体の大きさとする
 */
export function regionPixelSize(box: Region['box'], v: RegionView): number {
  const spanX = v.east - v.west
  const spanY = mercY(v.north) - mercY(v.south)
  if (!(spanX > 0) || !(spanY > 0)) return 0
  const w = ((box.east - box.west) / spanX) * v.widthPx
  const h = ((mercY(box.north) - mercY(box.south)) / spanY) * v.heightPx
  return Math.sqrt(Math.max(w, 0) * Math.max(h, 0))
}

/**
 * Region が有効か。範囲が表示範囲と重なり、Lod があれば minLodPixels ≤ 大きさ < maxLodPixels
 * （maxLodPixels = -1 は上限なし）。Lod が無ければ、範囲が重なれば有効
 */
export function regionActive(region: Region, v: RegionView): boolean {
  if (!intersects(region.box, v)) return false
  const lod = region.lod
  if (!lod) return true
  const size = regionPixelSize(region.box, v)
  if (size < lod.minLodPixels) return false
  return lod.maxLodPixels < 0 || size < lod.maxLodPixels
}

/** 文書に Region が 1 つでもあるか（無ければ表示切替は不要） */
export function hasRegions(doc: KmlDocument): boolean {
  const walk = (f: Feature): boolean => !!f.region || childrenOf(f).some(walk)
  return walk(doc.root)
}

/**
 * 現在の表示で見える Placemark の kmlPath（'0/2/1' 形式）の集合。
 * Region は子孫に及ぶ（祖先のどれかの Region が無効なら、その配下は表示しない）。visibility=0 も除く
 */
export function visiblePlacemarkKeys(doc: KmlDocument, view: RegionView): Set<string> {
  const out = new Set<string>()
  const walk = (f: Feature, path: FeaturePath) => {
    if (!f.visibility) return
    if (f.region && !regionActive(f.region, view)) return
    if (f.kind === 'Placemark') {
      out.add(path.join('/'))
      return
    }
    childrenOf(f).forEach((c, i) => walk(c, [...path, i]))
  }
  walk(doc.root, [])
  return out
}
