// ジオイド高 N（楕円体高 = 標高（ジオイド基準）+ N）の推定。
// MapLibre の地形（Mapterhorn）は標高がジオイド基準、Navara / Cesium の地形は楕円体高（Re:Earth Terrain は
// Mapterhorn を EGM2008 で補正したもの）で、東京では約 36〜37 m ずれる。カメラ位置をエンジン間で受け渡すとき、
// この差が高度・ズームのずれになる。
// 同じ位置の 2 つの DEM タイル（楕円体高版と標高版）の差を取れば N が得られる（地形の起伏は引き算で消える）。
// 専用のジオイドグリッドは持たず、近くのタイル 1 枚ずつを必要なときだけ取得して使う。

/** 差を取るタイルのズーム（z7: 1 枚が約 2.8°×2.8°・512 px で約 600 m/px。N は滑らかなので十分） */
const GEOID_ZOOM = 7
/** 楕円体高版の DEM（Navara と同じ配信。terrarium、512 px） */
const ELLIPSOID_TILES = 'https://terrain.reearth.land/mapterhorn-egm08/terrarium/ellipsoid/{z}/{x}/{y}.webp'
/** 標高版の DEM（MapLibre の地形ソースと同じ） */
const MAPTERHORN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json'
/** 平均を取る窓（片側の画素数）。2 つの DEM の位置ずれ・ノイズをならす */
const WINDOW = 2

interface Pixels {
  size: number
  data: Uint8ClampedArray
}

const tileCache = new Map<string, Promise<number[] | null>>()
/** 取得済みのタイルごとの N の格子（size×size）。同期の参照用 */
const grids = new Map<string, { size: number; n: Float32Array }>()
let orthoTemplate: Promise<string | null> | undefined

const tileXY = (lng: number, lat: number, z: number) => {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n
  const latR = (Math.max(Math.min(lat, 85.0511), -85.0511) * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n
  return { x, y }
}

async function decode(url: string): Promise<Pixels | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null
    g.drawImage(bmp, 0, 0)
    return { size: bmp.width, data: g.getImageData(0, 0, bmp.width, bmp.height).data }
  } catch {
    return null
  }
}

/** terrarium: 標高 = R*256 + G + B/256 − 32768 */
const elev = (p: Pixels, i: number) => p.data[i] * 256 + p.data[i + 1] + p.data[i + 2] / 256 - 32768

async function orthoUrl(z: number, x: number, y: number): Promise<string | null> {
  orthoTemplate ??= fetch(MAPTERHORN_TILEJSON)
    .then((r) => r.json() as Promise<{ tiles?: string[] }>)
    .then((j) => j.tiles?.[0] ?? null)
    .catch(() => null)
  const t = await orthoTemplate
  return t ? t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)) : null
}

async function loadGrid(z: number, x: number, y: number): Promise<void> {
  const key = `${z}/${x}/${y}`
  if (grids.has(key)) return
  let p = tileCache.get(key)
  if (!p) {
    p = (async () => {
      const ortho = await orthoUrl(z, x, y)
      if (!ortho) return null
      const [a, b] = await Promise.all([
        decode(ELLIPSOID_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))),
        decode(ortho),
      ])
      if (!a || !b || a.size !== b.size) return null
      const n = new Float32Array(a.size * a.size)
      for (let i = 0; i < n.length; i++) n[i] = elev(a, i * 4) - elev(b, i * 4)
      grids.set(key, { size: a.size, n })
      return []
    })()
    tileCache.set(key, p)
  }
  await p
  // 取得に失敗したタイルは、次の機会にやり直せるよう記録を消す
  if (!grids.has(key)) tileCache.delete(key)
}

function sample(lng: number, lat: number): number | undefined {
  const { x, y } = tileXY(lng, lat, GEOID_ZOOM)
  const g = grids.get(`${GEOID_ZOOM}/${Math.floor(x)}/${Math.floor(y)}`)
  if (!g) return undefined
  const px = Math.min(Math.max(Math.floor((x - Math.floor(x)) * g.size), 0), g.size - 1)
  const py = Math.min(Math.max(Math.floor((y - Math.floor(y)) * g.size), 0), g.size - 1)
  let sum = 0
  let count = 0
  for (let j = Math.max(py - WINDOW, 0); j <= Math.min(py + WINDOW, g.size - 1); j++)
    for (let i = Math.max(px - WINDOW, 0); i <= Math.min(px + WINDOW, g.size - 1); i++) {
      sum += g.n[j * g.size + i]
      count++
    }
  return count ? sum / count : undefined
}

/** 取得済みなら即座に N（m）を返す。未取得は undefined（geoidHeight を先に呼んでおく） */
export function geoidHeightCached(lng: number, lat: number): number | undefined {
  return sample(lng, lat)
}

/** その地点の N（m）。タイルが取れなければ undefined（呼び出し側は 0 m 扱い） */
export async function geoidHeight(lng: number, lat: number): Promise<number | undefined> {
  const { x, y } = tileXY(lng, lat, GEOID_ZOOM)
  await loadGrid(GEOID_ZOOM, Math.floor(x), Math.floor(y))
  return sample(lng, lat)
}
