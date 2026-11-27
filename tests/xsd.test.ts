// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { listKml, validateKmlXsd } from './xsd'

describe('KML XSD(2.2): fixtures', () => {
  for (const f of listKml('valid')) {
    it(`valid/${f.name} は XSD に適合する`, async () => {
      const r = await validateKmlXsd(f.text, f.name)
      expect(r.errors).toEqual([])
      expect(r.valid).toBe(true)
    })
  }
  for (const f of listKml('invalid')) {
    it(`invalid/${f.name} は XSD で不適合になる`, async () => {
      const r = await validateKmlXsd(f.text, f.name)
      expect(r.valid).toBe(false)
      expect(r.errors.length).toBeGreaterThan(0)
    })
  }
})
