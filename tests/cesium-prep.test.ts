// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { prepareForCesium, stripViewDrivenLinks } from '../src/kml/cesium-prep'
import { readKmlFile, writeKmz } from '../src/kml/kmz'

const nl = (name: string, link: string) => `<NetworkLink><name>${name}</name><Link><href>http://example.com/${name}.kml</href>${link}</Link></NetworkLink>`
const kml = (body: string) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>d</name>${body}</Document></kml>`

describe('stripViewDrivenLinks', () => {
  it('onStop / onRegion の NetworkLink だけを取り除く', () => {
    const out = stripViewDrivenLinks(
      kml(
        nl('stop', '<viewRefreshMode>onStop</viewRefreshMode>') +
          nl('region', '<viewRefreshMode>onRegion</viewRefreshMode>') +
          nl('never', '<viewRefreshMode>never</viewRefreshMode>') +
          nl('interval', '<refreshMode>onInterval</refreshMode>') +
          '<Placemark><name>p</name><Point><coordinates>1,2</coordinates></Point></Placemark>',
      ),
    )!
    expect(out).not.toContain('stop.kml')
    expect(out).not.toContain('region.kml')
    expect(out).toContain('never.kml')
    expect(out).toContain('interval.kml')
    expect(out).toContain('<name>p</name>')
  })

  it('入れ子のフォルダ内の NetworkLink も、旧形式の Url も対象', () => {
    const out = stripViewDrivenLinks(
      kml(`<Folder><NetworkLink><name>old</name><Url><href>http://example.com/old.kml</href><viewRefreshMode>onStop</viewRefreshMode></Url></NetworkLink></Folder>`),
    )!
    expect(out).not.toContain('old.kml')
    expect(out).toContain('<Folder')
  })

  it('該当が無ければ null（元のまま使う）', () => {
    expect(stripViewDrivenLinks(kml(nl('a', '<refreshMode>onChange</refreshMode>')))).toBeNull()
  })
})

describe('prepareForCesium', () => {
  it('該当が無ければ同じファイルを返す', async () => {
    const f = new File([kml(nl('a', ''))], 'a.kml')
    expect(await prepareForCesium(f)).toBe(f)
  })

  it('KML は取り除いた版を返す', async () => {
    const f = new File([kml(nl('s', '<viewRefreshMode>onStop</viewRefreshMode>'))], 'a.kml')
    const out = await prepareForCesium(f)
    expect(await out.text()).not.toContain('s.kml')
  })

  it('KMZ は同梱ファイルを保ったまま KMZ で返す', async () => {
    const png = new Uint8Array([1, 2, 3, 4])
    const kmz = new File([writeKmz(kml(nl('s', '<viewRefreshMode>onRegion</viewRefreshMode>')), { 'files/a.png': png }) as BlobPart], 'a.kmz')
    const out = await prepareForCesium(kmz)
    expect(out.name).toBe('a.kmz')
    const back = await readKmlFile(out)
    expect(back.kml).not.toContain('s.kml')
    expect(Array.from(back.files['files/a.png'])).toEqual([1, 2, 3, 4])
  })
})
