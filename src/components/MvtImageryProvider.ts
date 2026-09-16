import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import {
  Credit,
  Event as CesiumEvent,
  Rectangle,
  WebMercatorTilingScheme,
  type ImageryProvider,
  type Request,
  type TileDiscardPolicy,
  type TilingScheme,
} from 'cesium'
import { VECTOR_LAYERS } from './cesiumVectorLayers'

const TILE_SIZE = 256

interface Options {
  /** {z}/{x}/{y} を含むタイル URL テンプレート */
  urlTemplate: string
  maximumLevel: number
  credit: string
}

/**
 * Cesium は MVT をネイティブに描画できないため、ベクタータイルを Canvas 2D に
 * 描いてイメージャリとして返す ImageryProvider。
 *
 * 1 タイルにつき pbf を 1 回だけパースし、VECTOR_LAYERS の全ソースレイヤーを
 * 定義順に描く。ソースレイヤーごとにプロバイダを分けるとタイルを層の数だけ
 * パースすることになるため、この方式にしている。
 */
export class MvtImageryProvider implements ImageryProvider {
  readonly tileWidth = TILE_SIZE
  readonly tileHeight = TILE_SIZE
  readonly minimumLevel = 0
  readonly maximumLevel: number
  readonly tilingScheme: TilingScheme = new WebMercatorTilingScheme()
  readonly rectangle: Rectangle
  readonly errorEvent = new CesiumEvent()
  readonly credit: Credit
  readonly hasAlphaChannel = true
  readonly tileDiscardPolicy = undefined as unknown as TileDiscardPolicy
  readonly proxy = undefined as unknown as ImageryProvider['proxy']
  readonly defaultAlpha = undefined
  readonly defaultNightAlpha = undefined
  readonly defaultDayAlpha = undefined
  readonly defaultBrightness = undefined
  readonly defaultContrast = undefined
  readonly defaultHue = undefined
  readonly defaultSaturation = undefined
  readonly defaultGamma = undefined
  readonly defaultMinificationFilter = undefined
  readonly defaultMagnificationFilter = undefined
  readonly ready = true
  readonly readyPromise = Promise.resolve(true)

  private readonly urlTemplate: string

  constructor(options: Options) {
    this.urlTemplate = options.urlTemplate
    this.maximumLevel = options.maximumLevel
    this.credit = new Credit(options.credit, true)
    this.rectangle = this.tilingScheme.rectangle
  }

  getTileCredits(): Credit[] {
    return []
  }

  pickFeatures(): undefined {
    return undefined
  }

  async requestImage(
    x: number,
    y: number,
    level: number,
    _request?: Request,
  ): Promise<HTMLCanvasElement> {
    const url = this.urlTemplate
      .replace('{z}', String(level))
      .replace('{x}', String(x))
      .replace('{y}', String(y))

    const canvas = document.createElement('canvas')
    canvas.width = TILE_SIZE
    canvas.height = TILE_SIZE
    const ctx = canvas.getContext('2d')

    const response = await fetch(url)
    // データのないタイルは 404 を返す。透明なタイルとして扱う
    if (!ctx || !response.ok) return canvas

    const tile = new VectorTile(new PbfReader(await response.arrayBuffer()))

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'

    for (const spec of VECTOR_LAYERS) {
      if (level < spec.minZoom) continue
      const layer = tile.layers[spec.sourceLayer]
      if (!layer) continue

      const scale = TILE_SIZE / layer.extent
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i)
        const style = spec.style(feature.properties)
        if (!style.fillStyle && !style.strokeStyle) continue

        ctx.beginPath()
        for (const ring of feature.loadGeometry()) {
          ring.forEach((point, index) => {
            const px = point.x * scale
            const py = point.y * scale
            if (index === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          })
          // ポリゴンはリングを閉じる（MVT の geometry type 3）
          if (feature.type === 3) ctx.closePath()
        }
        if (style.fillStyle) {
          ctx.fillStyle = style.fillStyle
          ctx.fill()
        }
        if (style.strokeStyle) {
          ctx.strokeStyle = style.strokeStyle
          ctx.lineWidth = style.lineWidth ?? 1
          ctx.stroke()
        }
      }
    }

    return canvas
  }
}
