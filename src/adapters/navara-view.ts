import type ThreeView from '@navaramap/three'
import { vector3ToGeodetic } from '@navaramap/three'
import type { DefaultDescriptions } from '@navaramap/three-default-plugin'
import type { RegionView } from '../kml/region'

type View = ThreeView<DefaultDescriptions>

/** 画面を格子に区切って地表を引く点の数（片側） */
const GRID = 5

/**
 * Navara の現在の表示範囲（Region / NetworkLink の判定用）。Navara には表示範囲を直接返す API が無いため、
 * 画面を格子状に区切って地表の位置を引き（pickTerrainPosition）、その経緯度の外接矩形を使う近似。
 * - 傾いて空が映る・地球が丸ごと見えるときは、地表に当たらない点がある。当たった点だけの矩形になり、
 *   実際の見える範囲より小さくなりうる
 * - 当たった点が無いときは null（呼び出し側は更新しない）
 * - 外接矩形が日付変更線をまたぐ（経度の幅が 300° 超）ときは全経度とする
 */
export function navaraRegionView(view: View): RegionView | null {
  const canvas = view.canvas
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null // 非表示
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  let hits = 0
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      // 端ぴったりは外れやすいので 1px 内側から
      const x = rect.left + 1 + ((rect.width - 2) * i) / (GRID - 1)
      const y = rect.top + 1 + ((rect.height - 2) * j) / (GRID - 1)
      const p = view.pickTerrainPosition(x, y)
      if (!p) continue
      const g = vector3ToGeodetic(p)
      if (!Number.isFinite(g.lng) || !Number.isFinite(g.lat)) continue
      hits++
      west = Math.min(west, g.lng)
      east = Math.max(east, g.lng)
      south = Math.min(south, g.lat)
      north = Math.max(north, g.lat)
    }
  }
  if (hits === 0) return null
  if (east - west > 300) {
    west = -180
    east = 180
  }
  return { west, south, east, north, widthPx: rect.width, heightPx: rect.height }
}
