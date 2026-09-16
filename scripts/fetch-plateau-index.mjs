// PLATEAU の建築物モデル 3D Tiles の索引を生成する。
//
// カタログ API には各データセットの地理的範囲が入っていないため、tileset.json の
// root.boundingVolume.region から取る。tileset.json は 1 本 300KB 超あるが、
// boundingVolume は先頭数 KB に現れるので Range リクエストで頭だけ取得する。
//
// 実行:  pnpm plateau:index
// 出力:  public/plateau-buildings.json
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CATALOG = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'
const HEAD_BYTES = 32768
const CONCURRENCY = 16

const toDeg = (rad) => Number(((rad * 180) / Math.PI).toFixed(5))

/**
 * テクスチャを持たないものを優先しつつ、自治体ごとに (year, lod) が最大のものを残す。
 *
 * 建物は一律のグレーで描くためテクスチャを使わない。PLATEAU は _no_texture 版を
 * 配信しており、LOD1 はもともと箱のみでテクスチャを持たない。テクスチャを
 * 読まないぶん転送量と描画負荷が下がる（全 448 自治体に無テクスチャ版がある）。
 */
function isUntextured(d) {
  return d.url.includes('_no_texture') || String(d.lod) === '1'
}

function pickLatest(datasets) {
  const byMunicipality = new Map()
  for (const d of datasets) {
    if (d.type !== '建築物モデル' || d.format !== '3D Tiles' || !d.url) continue
    const key = `${d.city_code ?? d.pref_code}/${d.city ?? ''}/${d.ward ?? ''}`
    const list = byMunicipality.get(key)
    if (list) list.push(d)
    else byMunicipality.set(key, [d])
  }

  const best = []
  for (const list of byMunicipality.values()) {
    const untextured = list.filter(isUntextured)
    const pool = untextured.length > 0 ? untextured : list
    best.push(
      pool.reduce((a, b) =>
        (b.year ?? 0) > (a.year ?? 0) ||
        ((b.year ?? 0) === (a.year ?? 0) && Number(b.lod ?? 0) > Number(a.lod ?? 0))
          ? b
          : a,
      ),
    )
  }
  return best
}

const REGION_RE = /"region"\s*:\s*\[([^\]]+)\]/

/**
 * tileset.json の先頭だけ読んで boundingVolume.region を抜く。
 * Range はバイト単位なので、属性に日本語が多いと先頭に収まらないことがある。
 * その場合だけ全体を読み直す。
 */
async function fetchRegion(url) {
  const head = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } }).then((r) => {
    if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`)
    return r.text()
  })
  let match = head.match(REGION_RE)
  if (!match) {
    const whole = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    })
    match = whole.match(REGION_RE)
  }
  if (!match) throw new Error('region not found')
  const [west, south, east, north] = match[1].split(',').map((v) => Number(v.trim()))
  return { west: toDeg(west), south: toDeg(south), east: toDeg(east), north: toDeg(north) }
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index], index)
      }
    }),
  )
  return results
}

const catalog = await fetch(CATALOG).then((r) => r.json())
const targets = pickLatest(catalog.datasets)
console.log(`対象データセット: ${targets.length} 件`)

let done = 0
const entries = await mapWithLimit(targets, CONCURRENCY, async (d) => {
  try {
    const region = await fetchRegion(d.url)
    return { name: d.city ? `${d.pref}${d.city}${d.ward ?? ''}` : d.name, url: d.url, ...region }
  } catch (err) {
    console.warn(`skip ${d.name}: ${err.message}`)
    return null
  } finally {
    if (++done % 50 === 0) console.log(`  ${done}/${targets.length}`)
  }
})

const valid = entries.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
const out = join(process.cwd(), 'public', 'plateau-buildings.json')
writeFileSync(out, JSON.stringify(valid))
console.log(`書き出し: ${out} (${valid.length} 件, ${(JSON.stringify(valid).length / 1024).toFixed(1)} KB)`)
