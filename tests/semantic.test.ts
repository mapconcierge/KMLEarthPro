// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { validateKmlSemantics } from '../src/kml/validate'
import { listKml, validateKmlXsd } from './xsd'

describe('意味検査(validateKmlSemantics)', () => {
  it('valid フィクスチャは error も warning も出ない', () => {
    for (const f of listKml('valid')) expect(validateKmlSemantics(f.text), f.name).toEqual([])
  })
  // semantic/ は XSD では適合し、意味検査で、ファイル名の規則 ID が検出されるもの
  for (const f of listKml('semantic')) {
    const rule = f.name.match(/^(KML-V\d+)/)![1]
    it(`semantic/${f.name} は ${rule} を検出し、XSD は通る`, async () => {
      const issues = validateKmlSemantics(f.text)
      expect(issues.map((i) => i.rule)).toContain(rule)
      expect((await validateKmlXsd(f.text, f.name)).errors, 'XSD では検出されない').toEqual([])
    })
  }
})
