import { useMemo, useState } from 'react'
import { resolveFlyView, type FeaturePath } from '../kml/target'
import type { Feature, KmlDocument } from '../kml/types'
import './KmlTree.css'

/** 1 フォルダで一度に描画する子の上限（数千件の Placemark でサイドバーが重くなるのを防ぐ） */
const MAX_CHILDREN_RENDERED = 200

interface Props {
  doc: KmlDocument
  /** null のときは飛べない（エンジン未初期化など） */
  onFly: ((path: FeaturePath) => void) | null
}

/** KML のフォルダ/Placemark の木。Placemark（やフォルダ）を選ぶとその位置へ飛ぶ */
export default function KmlTree({ doc, onFly }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const root = doc.root
  return (
    <ul className="kml-tree">
      <Children doc={doc} parent={root} path={[]} selected={selected} setSelected={setSelected} onFly={onFly} />
    </ul>
  )
}

interface ChildrenProps extends Props {
  parent: Feature
  path: FeaturePath
  selected: string | null
  setSelected: (key: string) => void
}

function Children({ doc, parent, path, selected, setSelected, onFly }: ChildrenProps) {
  if (parent.kind === 'Placemark') return null
  const shown = parent.children.slice(0, MAX_CHILDREN_RENDERED)
  const rest = parent.children.length - shown.length
  return (
    <>
      {shown.map((f, i) => (
        <Node key={i} doc={doc} feature={f} path={[...path, i]} selected={selected} setSelected={setSelected} onFly={onFly} />
      ))}
      {rest > 0 && <li className="kml-tree-more">ほか {rest} 件（省略）</li>}
    </>
  )
}

interface NodeProps extends Props {
  feature: Feature
  path: FeaturePath
  selected: string | null
  setSelected: (key: string) => void
}

function Node({ doc, feature, path, selected, setSelected, onFly }: NodeProps) {
  const [open, setOpen] = useState(feature.kind !== 'Placemark' && feature.open)
  const key = path.join('/')
  const label = feature.name?.trim() || (feature.kind === 'Placemark' ? '(名称なし)' : '(フォルダ)')
  // 視点もジオメトリも無いフィーチャは飛べない
  const canFly = useMemo(() => resolveFlyView(doc, path) !== undefined, [doc, path])
  const fly = () => {
    setSelected(key)
    onFly?.(path)
  }
  const cls = `kml-tree-label ${selected === key ? 'selected' : ''} ${feature.visibility ? '' : 'hidden'}`

  if (feature.kind === 'Placemark') {
    return (
      <li className="kml-tree-item">
        <button className={cls} disabled={!canFly || !onFly} onClick={fly} title={label}>
          <span className="kml-tree-icon">●</span>
          {label}
        </button>
      </li>
    )
  }
  return (
    <li className="kml-tree-item">
      <div className="kml-tree-folder">
        <button
          className="kml-tree-caret"
          aria-label={open ? '閉じる' : '開く'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <button className={cls} disabled={!canFly || !onFly} onClick={fly} title={label}>
          {label}
          <span className="kml-tree-count">{feature.children.length}</span>
        </button>
      </div>
      {open && (
        <ul className="kml-tree kml-tree-nested">
          <Children doc={doc} parent={feature} path={path} selected={selected} setSelected={setSelected} onFly={onFly} />
        </ul>
      )}
    </li>
  )
}
