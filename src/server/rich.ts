import type { Mentions, RichDoc } from '../contract/index.js'

/**
 * Helpers for the Tiptap/ProseMirror JSON documents stored in `messages.body`.
 * Mention nodes are `{ type: 'mention', attrs: { id, label, kind: 'user' | 'group' | 'channel' | 'everyone' } }`.
 */
export type PmNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'blockquote',
  'listItem',
  'bulletList',
  'orderedList',
  'taskItem',
  'taskList',
  'horizontalRule',
])

/** Plain-text rendering used for search, notifications and previews. */
export function docToText(doc: RichDoc | PmNode | null | undefined): string {
  if (!doc) return ''
  const out: string[] = []
  const walk = (node: PmNode, depth: number) => {
    if (node.type === 'text') {
      out.push(node.text ?? '')
      return
    }
    if (node.type === 'hardBreak') {
      out.push('\n')
      return
    }
    if (node.type === 'mention') {
      const a = node.attrs ?? {}
      const kind = (a.kind as string) ?? 'user'
      const label = (a.label as string) ?? (a.id as string) ?? ''
      out.push(kind === 'channel' ? `#${label}` : `@${label}`)
      return
    }
    if (node.type === 'emoji') {
      out.push((node.attrs?.name as string) ? `:${node.attrs?.name}:` : '')
      return
    }
    const isBlock = node.type ? BLOCK_TYPES.has(node.type) : false
    for (const child of node.content ?? []) walk(child, depth + 1)
    if (isBlock && depth > 0) out.push('\n')
  }
  walk(doc as PmNode, 0)
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Extract mentions from the document (mention nodes + literal `@channel` / `@here` tokens outside code). */
export function extractMentions(doc: RichDoc | PmNode | null | undefined): Mentions {
  const users = new Set<string>()
  const groups = new Set<string>()
  let channel = false
  const walk = (node: PmNode, inCode: boolean) => {
    const code = inCode || node.type === 'codeBlock' || (node.marks ?? []).some((m) => m.type === 'code')
    if (node.type === 'mention') {
      const a = node.attrs ?? {}
      const kind = (a.kind as string) ?? 'user'
      const id = typeof a.id === 'string' ? a.id : null
      if (kind === 'user' && id) users.add(id)
      else if (kind === 'group' && id) groups.add(id)
      else if (kind === 'everyone') channel = true
      return
    }
    if (node.type === 'text' && !code && node.text && /(^|\s)@(channel|here|all)\b/.test(node.text))
      channel = true
    for (const child of node.content ?? []) walk(child, code)
  }
  if (doc) walk(doc as PmNode, false)
  return { users: [...users] as Mentions['users'], groups: [...groups], channel }
}

/** Build a minimal document from plain text (system messages, webhooks, slash command output). */
export function textToDoc(text: string): RichDoc {
  const paragraphs = text.split(/\n{2,}/).map((p) => {
    const lines = p.split('\n')
    const content: PmNode[] = []
    lines.forEach((line, i) => {
      if (i > 0) content.push({ type: 'hardBreak' })
      if (line.length) content.push({ type: 'text', text: line })
    })
    return { type: 'paragraph', content: content.length ? content : undefined }
  })
  return { type: 'doc', content: paragraphs }
}

export function isEmptyDoc(doc: RichDoc): boolean {
  return docToText(doc).length === 0 && !hasNonTextContent(doc as PmNode)
}
function hasNonTextContent(node: PmNode): boolean {
  if (
    node.type === 'image' ||
    node.type === 'emoji' ||
    node.type === 'mention' ||
    node.type === 'horizontalRule'
  )
    return true
  return (node.content ?? []).some(hasNonTextContent)
}

/** Short single-line preview (notifications, sidebar). */
export function preview(text: string, max = 140): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
