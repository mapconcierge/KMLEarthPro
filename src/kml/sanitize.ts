// KML の description / BalloonStyle は HTML を含みうる。外部ファイル由来なので、
// 許可リストに無い要素・属性・URL を落としてから表示する（script / iframe / on* / javascript: など）。

const ALLOWED_TAGS = new Set([
  'a', 'b', 'i', 'u', 'em', 'strong', 'br', 'p', 'div', 'span', 'img', 'hr', 'small', 'sub', 'sup', 'pre', 'code',
  'blockquote', 'center', 'font', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
])
/** 中身ごと捨てる要素（子の文字列も表示しない） */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'noscript', 'svg', 'math', 'template'])
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'color', 'size', 'align'])

const safeUrl = (v: string, attr: 'href' | 'src') => {
  const u = v.trim()
  if (attr === 'href') return /^(https?:|mailto:)/i.test(u)
  return /^(https?:|blob:|data:image\/(png|jpe?g|gif|webp);)/i.test(u)
}

function clean(node: Node, out: Node, doc: Document): void {
  for (const c of Array.from(node.childNodes)) {
    if (c.nodeType === 3) {
      out.appendChild(doc.createTextNode(c.textContent ?? ''))
    } else if (c.nodeType === 1) {
      const el = c as Element
      const tag = el.localName
      if (DROP_WITH_CONTENT.has(tag)) continue
      if (!ALLOWED_TAGS.has(tag)) {
        clean(el, out, doc) // 未知の要素は外して中身だけ残す
        continue
      }
      const n = doc.createElement(tag)
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase()
        if (!ALLOWED_ATTRS.has(name)) continue
        if ((name === 'href' || name === 'src') && !safeUrl(a.value, name)) continue
        n.setAttribute(name, a.value)
      }
      if (tag === 'a' && n.hasAttribute('href')) {
        n.setAttribute('target', '_blank')
        n.setAttribute('rel', 'noopener noreferrer')
      }
      clean(el, n, doc)
      out.appendChild(n)
    }
  }
}

/** HTML 断片を許可リストで浄化し、安全な HTML 文字列を返す */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const box = doc.createElement('div')
  clean(doc.body, box, doc)
  return box.innerHTML
}

/** BalloonStyle の text テンプレートの $[name] / $[description] を置き換える（HTML 浄化の前に呼ぶ） */
export function expandBalloonText(template: string, name: string, description: string): string {
  return template.replace(/\$\[(name|description)\]/g, (_, k: string) => (k === 'name' ? name : description))
}
