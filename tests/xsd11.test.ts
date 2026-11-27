// @vitest-environment happy-dom
// Java の Apache Xerces-J（XSD 1.1）による検証。KML 2.3 の XSD（XSD 1.1）は libxml2 では読めないため、ここで行う。
// Java か Xerces（pnpm xsd11:setup で取得）が無い環境ではスキップする。
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { hasJava, hasXerces, validateXsd11 } from '../scripts/xsd11/xerces.mjs'
import { parseKml } from '../src/kml/parse'
import { serializeKml } from '../src/kml/serialize'
import { listKml, validateKmlXsd } from './xsd'

const ready = hasJava() && hasXerces()
if (!ready) console.warn('[xsd11] Java または Xerces が無いため XSD 1.1 の検証をスキップします（pnpm xsd11:setup で取得）')

type Result = { file: string; valid: boolean; errors: string[] }
const sets = ['valid', 'invalid', 'semantic', 'kml23/valid', 'kml23/invalid'].map((d) => ({ dir: d, files: ready ? listKml(d) : [] }))
const byName = (rs: Result[], files: { path: string }[]) => new Map(files.map((f, i) => [f.path, rs[i]] as const))

describe.skipIf(!ready)('KML 2.3 XSD（XSD 1.1, Xerces）', () => {
  let v23: Map<string, Result>
  let v22: Map<string, Result>
  const all = sets.flatMap((s) => s.files)
  beforeAll(async () => {
    // ファイルごとに JVM を起動する（並列 4）ので時間がかかる
    v23 = byName(await validateXsd11(all.map((f) => f.path), '2.3'), all)
    v22 = byName(await validateXsd11(all.map((f) => f.path), '2.2'), all)
  }, 120_000)

  for (const f of listKml('valid')) {
    it(`valid/${f.name} は 2.3 の XSD に適合する`, () => {
      expect(v23.get(f.path)?.errors).toEqual([])
    })
  }
  for (const f of listKml('semantic')) {
    it(`semantic/${f.name} は XSD には適合する（意味検査だけが検出する）`, () => {
      expect(v23.get(f.path)?.errors).toEqual([])
    })
  }
  for (const f of listKml('invalid')) {
    // 2.3 の XSD は要素の順序を問わない（xs:all）。2.2 は順序を強制するので、05 だけ結果が分かれる
    if (f.name.startsWith('05-wrong-order')) {
      it(`invalid/${f.name}: 2.2 の XSD では不適合、2.3 の XSD では適合（要素順を問わなくなったため）`, () => {
        expect(v22.get(f.path)?.valid).toBe(false)
        expect(v23.get(f.path)?.valid).toBe(true)
      })
    } else {
      it(`invalid/${f.name} は 2.3 の XSD で不適合になる`, () => {
        expect(v23.get(f.path)?.valid).toBe(false)
      })
    }
  }

  it('KML 2.3 で追加された要素は、version="2.3" のときだけ適合する（XSD 1.1 のアサーション）', () => {
    const good = listKml('kml23/valid')[0]
    const bad = listKml('kml23/invalid')[0]
    expect(v23.get(good.path)?.errors).toEqual([])
    const r = v23.get(bad.path)!
    expect(r.valid).toBe(false)
    expect(r.errors.join('\n')).toContain('cvc-assertion')
    // 2.2 の XSD は、そもそも 2.3 の要素を知らない
    expect(v22.get(good.path)?.valid).toBe(false)
  })

  it('Xerces（2.2 の XSD）と libxml2（2.2 の XSD）が、全 fixture で同じ結論を出す（独立した 2 実装の相互検証）', async () => {
    const files = [...listKml('valid'), ...listKml('invalid'), ...listKml('semantic')]
    for (const f of files) {
      const libxml2 = await validateKmlXsd(f.text, f.name)
      expect(v22.get(f.path)?.valid, `${f.name}: Xerces と libxml2 の結果が違う`).toBe(libxml2.valid)
    }
  })

  it('シリアライザの出力が 2.3 の XSD に適合する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kml-xsd11-'))
    // 08-cdata は happy-dom が CDATA 内の < を扱えず、パースできないので除く
    const inputs = listKml('valid').filter((f) => !f.name.includes('cdata'))
    const paths = inputs.map((f) => {
      const p = join(dir, f.name)
      writeFileSync(p, serializeKml(parseKml(f.text)))
      return p
    })
    const rs = await validateXsd11(paths, '2.3')
    expect(rs.map((r) => [r.file.split('/').pop(), r.errors])).toEqual(inputs.map((f) => [f.name, []]))
  })
})
