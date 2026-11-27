// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseKml } from '../src/kml/parse'
import { serializeKml } from '../src/kml/serialize'
import { validateKmlSemantics } from '../src/kml/validate'
import { listKml, validateKmlXsd } from './xsd'

// 読み込み → 保存で出力される KML が、KML の XSD と意味検査に適合し、再読み込みで同じ文書になること
describe('シリアライザ出力の適合', () => {
  // 08-cdata は happy-dom の XML パーサーが CDATA 内の < を扱えないため対象外（XSD 検証は tests/xsd.test.ts、
  // 実ブラウザでの CDATA は Playwright で確認済み）
  for (const f of listKml('valid').filter((x) => !x.name.includes('cdata'))) {
    it(`valid/${f.name}: parse → serialize の出力が XSD に適合する`, async () => {
      const out = serializeKml(parseKml(f.text))
      const r = await validateKmlXsd(out, f.name)
      expect(r.errors, out).toEqual([])
      expect(validateKmlSemantics(out)).toEqual([])
    })
    it(`valid/${f.name}: 往復（parse → serialize → parse）で文書モデルが変わらない`, () => {
      const a = parseKml(f.text)
      const b = parseKml(serializeKml(a))
      expect(b).toEqual(a)
    })
  }
})
