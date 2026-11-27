import { expect, test, type Page } from '@playwright/test'

/**
 * 3 エンジンの画面座標の一致（Issue #9）。
 * 東京のお気に入り地点へ飛び、地表の格子点が画面のどこに映るかを MapLibre / Navara / CesiumJS で測って比べる。
 * エンジンの切替でカメラ位置は引き継がれるので、同じカメラ位置・画角なら同じ画面座標になるはず。
 * 基準は CesiumJS（投影が標準的な透視投影）。
 */

type Pt = [number, number] | null
const ENGINES = [
  { id: '2d-maplibre', label: 'MapLibre GL JS' },
  { id: '3d-navara', label: 'Navara 3D' },
  { id: '3d-cesium', label: 'CesiumJS' },
] as const

// 地表（東京駅付近。標高 数 m + ジオイド高 約 36.5 m ≒ 楕円体高 40 m）の格子点。経緯度の差（度）
const GROUND_HEIGHT = 40
const OFFSETS: [number, number][] = []
for (let i = -6; i <= 6; i++) for (let j = -2; j <= 14; j++) OFFSETS.push([i * 0.005, j * 0.005])

async function measure(page: Page, engine: string, center: [number, number]): Promise<Pt[]> {
  return page.evaluate(
    ({ engine, center, offsets, h }) => {
      const access = (window as any).__kmlEarthPro.camera.getState().access[engine]
      return offsets.map(([dx, dy]: [number, number]) => access?.project?.(center[0] + dx, center[1] + dy, h) ?? null)
    },
    { engine, center, offsets: OFFSETS, h: GROUND_HEIGHT },
  )
}

test('東京で 3 エンジンの画面座標が一致する', async ({ page }) => {
  await page.goto('')
  await page.getByText('東京', { exact: true }).first().click()

  const poseOf = (engine: string) =>
    page.evaluate((e) => (window as any).__kmlEarthPro.camera.getState().access[e]?.get() ?? null, engine)

  // MapLibre がカメラを置き終えるのを待つ（姿勢が 1 秒以上動かなくなる）
  let prev = ''
  await expect
    .poll(async () => {
      const cur = JSON.stringify(await poseOf('2d-maplibre'))
      const stable = cur === prev
      prev = cur
      await page.waitForTimeout(1000)
      return stable
    }, { timeout: 60_000 })
    .toBe(true)
  const refPose = await poseOf('2d-maplibre')
  expect(refPose).not.toBeNull()
  const center: [number, number] = [139.7671, 35.6812]

  const result: Record<string, Pt[]> = {}
  const poses: Record<string, any> = {}
  for (const e of ENGINES) {
    if (e.id !== '2d-maplibre') await page.getByText(e.label, { exact: false }).first().click()
    // 切替先がカメラを置き、画面座標を返せるようになるまで待つ
    await expect
      .poll(async () => {
        const p = await poseOf(e.id)
        return p && Math.abs(p.lng - refPose.lng) < 1e-3 && Math.abs(p.lat - refPose.lat) < 1e-3 && Math.abs(p.height - refPose.height) / refPose.height < 0.01
      }, { timeout: 90_000, intervals: [1000] })
      .toBe(true)
    await page.waitForTimeout(2500)
    poses[e.id] = await poseOf(e.id)
    result[e.id] = await measure(page, e.id, center)
  }

  // 画面内（3 エンジン共通の表示領域）に映る点だけで比べる。傾きが大きい遠方ほど px の誤差は大きくなるので、近い点と遠い点を分ける
  const size = await page.evaluate(() => {
    const c = [...document.querySelectorAll('canvas')].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0)
    return { w: c?.width ?? 0, h: c?.height ?? 0 }
  })
  expect(size.w).toBeGreaterThan(0)
  const ref = result['3d-cesium']
  const onScreen = (p: Pt) => !!p && p[0] >= 0 && p[0] <= size.w && p[1] >= 0 && p[1] <= size.h
  const stats: Record<string, { near: number[]; far: number[] }> = {}
  for (const id of ['2d-maplibre', '3d-navara'] as const) {
    stats[id] = { near: [], far: [] }
    result[id].forEach((p, i) => {
      const r = ref[i]
      if (!onScreen(p) || !onScreen(r)) return
      // 画面の下半分を近景、上半分を遠景とする
      stats[id][r![1] > size.h / 2 ? 'near' : 'far'].push(Math.hypot(p![0] - r![0], p![1] - r![1]))
    })
  }
  const max = (a: number[]) => (a.length ? Math.max(...a) : NaN)
  // 許容値は実測（MapLibre 近景 2.3 px・遠景 5.8 px、Navara 0 px）に余裕を持たせたもの。
  // MapLibre は地形の標高とジオイド高の推定（数十 cm〜数 m）が入るので、Navara より大きくなる
  for (const id of ['2d-maplibre', '3d-navara'] as const) {
    expect(stats[id].near.length, `${id} 近景の点数`).toBeGreaterThanOrEqual(8)
    expect(stats[id].far.length, `${id} 遠景の点数`).toBeGreaterThanOrEqual(50)
  }
  expect(max(stats['2d-maplibre'].near), 'MapLibre 近景').toBeLessThan(6)
  expect(max(stats['2d-maplibre'].far), 'MapLibre 遠景').toBeLessThan(12)
  expect(max(stats['3d-navara'].near), 'Navara 近景').toBeLessThan(1)
  expect(max(stats['3d-navara'].far), 'Navara 遠景').toBeLessThan(1)
  console.log(JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { nNear: v.near.length, maxNear: max(v.near), nFar: v.far.length, maxFar: max(v.far) }]))))
})
