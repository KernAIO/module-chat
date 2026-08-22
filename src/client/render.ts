import type { RichDoc } from '../contract/index.js'

/**
 * Render a Tiptap/ProseMirror JSON document to sanitised HTML for read-only display.
 * All text is escaped; only a fixed set of node/mark types produces markup, and link
 * hrefs are restricted to http(s)/mailto — so the output is safe for `{@html}`.
 */
type Node = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: Node[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const safeHref = (href: unknown): string | null => {
  if (typeof href !== 'string') return null
  try {
    const u = new URL(href, 'https://x.invalid')
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? href : null
  } catch {
    return null
  }
}

function renderText(node: Node): string {
  let html = esc(node.text ?? '')
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`
        break
      case 'italic':
        html = `<em>${html}</em>`
        break
      case 'strike':
        html = `<s>${html}</s>`
        break
      case 'code':
        html = `<code class="kern-chat-code">${html}</code>`
        break
      case 'link': {
        const href = safeHref(mark.attrs?.href)
        if (href)
          html = `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow" class="kern-chat-link">${html}</a>`
        break
      }
      default:
        break
    }
  }
  return html
}

function renderNode(node: Node): string {
  switch (node.type) {
    case 'text':
      return renderText(node)
    case 'hardBreak':
      return '<br>'
    case 'paragraph':
      return `<p>${renderChildren(node)}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      return `<h${level}>${renderChildren(node)}</h${level}>`
    }
    case 'blockquote':
      return `<blockquote>${renderChildren(node)}</blockquote>`
    case 'codeBlock':
      return `<pre class="kern-chat-pre"><code>${esc(collectText(node))}</code></pre>`
    case 'bulletList':
      return `<ul>${renderChildren(node)}</ul>`
    case 'orderedList':
      return `<ol>${renderChildren(node)}</ol>`
    case 'listItem':
      return `<li>${renderChildren(node)}</li>`
    case 'horizontalRule':
      return '<hr>'
    case 'mention': {
      const a = node.attrs ?? {}
      const kind = typeof a.kind === 'string' ? a.kind : 'user'
      const label = esc(String(a.label ?? a.id ?? ''))
      const sigil = kind === 'channel' ? '#' : '@'
      return `<span class="kern-chat-mention" data-kind="${esc(kind)}" data-id="${esc(String(a.id ?? ''))}">${sigil}${label}</span>`
    }
    case 'emoji':
      return esc(
        typeof node.attrs?.emoji === 'string' ? (node.attrs.emoji as string) : `:${node.attrs?.name ?? ''}:`,
      )
    default:
      return renderChildren(node)
  }
}

const renderChildren = (node: Node): string => (node.content ?? []).map(renderNode).join('')

function collectText(node: Node): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(collectText).join('')
}

export function renderDocToHtml(doc: RichDoc | null | undefined): string {
  if (!doc) return ''
  return renderChildren(doc as Node)
}

// ---------------------------------------------------------------- time formatting

export function timeOf(iso: string, locale = 'en'): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function dayLabel(iso: string, locale = 'en', labels?: { today: string; yesterday: string }): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000)
  if (diff === 0 && labels) return labels.today
  if (diff === 1 && labels) return labels.yesterday
  return d.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
}

/** deterministic avatar color index 0-8 for the --kern-av-* palette */
export function avatarColorIndex(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 8) + 1
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase()
}
