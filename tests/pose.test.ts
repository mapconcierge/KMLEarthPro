import { describe, expect, it } from 'vitest'
import { centerZoomToPose, groundIntersection, poseToCenterZoom, VERTICAL_FOV_DEG } from '../src/kml/camera'

const base = { lng: 139.77, lat: 35.68, heading: 0 }

describe('poseToCenterZoom', () => {
  it('縦画角は 50°（Navara にそろえる）', () => {
    expect(VERTICAL_FOV_DEG).toBe(50)
  })

  it('真下向きなら中心はカメラの真下、ズームは実機（画面座標の比較）と一致する値', () => {
    // 高度 1,500 m・表示高さ 776 px: 実機で Cesium の画面座標と 1〜3 px で一致した換算（zoom 15.106）
    const v = poseToCenterZoom({ ...base, height: 1500, pitch: -90 }, 776)
    expect(v.center[0]).toBeCloseTo(139.77, 6)
    expect(v.center[1]).toBeCloseTo(35.68, 6)
    expect(v.zoom).toBeCloseTo(15.106, 2)
    expect(v.pitch).toBe(0)
    expect(v.bearing).toBe(0)
  })

  it('伏角 35° なら中心は進行方向（北）へ約 h/tan35°、傾きは 55°', () => {
    const v = poseToCenterZoom({ ...base, height: 1500, pitch: -35 }, 776)
    expect(v.pitch).toBeCloseTo(55, 6)
    const dNorthM = (v.center[1] - 35.68) * 110_574
    expect(dNorthM).toBeGreaterThan(2100)
    expect(dNorthM).toBeLessThan(2180) // 1500 / tan(35°) ≈ 2142 m（球面・緯度による差を含む）
    expect(v.zoom).toBeCloseTo(14.304, 2)
  })

  it('地面の標高が高いほど地面までの距離が縮み、ズームが上がる', () => {
    const flat = poseToCenterZoom({ ...base, height: 1500, pitch: -90 }, 776)
    const high = poseToCenterZoom({ ...base, height: 1500, pitch: -90 }, 776, () => 750)
    expect(high.zoom - flat.zoom).toBeCloseTo(1, 1) // 距離が半分 → ズーム +1
  })

  it('地球全体（高度 17,000 km）でも換算できる', () => {
    const v = poseToCenterZoom({ lng: 137, lat: 37, height: 17_000_000, heading: 0, pitch: -90 }, 776)
    expect(v.zoom).toBeCloseTo(1.64, 1)
  })

  it('水平に近い視線は注視距離 20 km で水平に進めた点を中心にする', () => {
    const v = poseToCenterZoom({ ...base, height: 200, pitch: -2, heading: 90 }, 776)
    expect(v.center[1]).toBeCloseTo(35.68, 3)
    expect(v.center[0]).toBeGreaterThan(139.77 + 0.15) // 東へ約 20 km ≈ 0.22°
    expect(v.pitch).toBe(85) // 最大傾きで頭打ち
  })
})

describe('groundIntersection', () => {
  it('水平より上を向くと当たらない', () => {
    expect(groundIntersection({ ...base, height: 1000, pitch: 10 })).toBeNull()
  })
  it('真下なら距離は高度に等しい', () => {
    expect(groundIntersection({ ...base, height: 1000, pitch: -90 })!.distance).toBeCloseTo(1000, 3)
  })
})

describe('centerZoomToPose（逆換算）', () => {
  const cases = [
    { height: 300, pitch: -90, heading: 0 },
    { height: 1500, pitch: -35, heading: 0 },
    { height: 1500, pitch: -35, heading: 135 },
    { height: 20_000, pitch: -60, heading: 300 },
    { height: 300_000, pitch: -35, heading: 20 },
    { height: 5_000_000, pitch: -90, heading: 0 },
    { height: 17_000_000, pitch: -90, heading: 0 },
  ]
  for (const c of cases) {
    it(`往復で元に戻る: 高度 ${c.height} m・伏角 ${c.pitch}°・方位 ${c.heading}°`, () => {
      const pose = { ...base, ...c, roll: 0 }
      const ground = (lng: number, lat: number) => 40 + 10 * Math.sin(lng) + 5 * Math.cos(lat) // なだらかに変わる標高
      const back = centerZoomToPose(poseToCenterZoom(pose, 776, ground), 776, ground)
      expect(back.lng).toBeCloseTo(pose.lng, 5)
      expect(back.lat).toBeCloseTo(pose.lat, 5)
      expect(Math.abs(back.height - pose.height) / pose.height).toBeLessThan(1e-4)
      expect(back.heading).toBeCloseTo(pose.heading, 6)
      expect(back.pitch).toBeCloseTo(pose.pitch, 6)
    })
  }
})
