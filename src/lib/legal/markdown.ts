/**
 * A deliberately small markdown parser for the legal documents in
 * docs/legal/ — headings, paragraphs, bullet and numbered lists, block
 * quotes, pipe tables, horizontal rules, fenced code, and inline bold /
 * code / links. Nothing else, because nothing else appears in those files
 * and a legal page must render exactly what counsel reviewed, not a
 * library's interpretation of it.
 *
 * Pure (no React) so it is unit-testable; src/components/legal/
 * LegalDocument.tsx turns the blocks into elements.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[]; id: string }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Block[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' }
  | { kind: 'code'; text: string }

/** `## 3. Skhokho Labs is the platform` → `3-skhokho-labs-is-the-platform` (anchor ids). */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) out.push({ kind: 'text', text: buf })
    buf = ''
  }
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (src[i] === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i) {
        flush()
        out.push({ kind: 'code', text: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (src[i] === '[') {
      const close = src.indexOf('](', i)
      const end = close > 0 ? src.indexOf(')', close + 2) : -1
      // Only real links: "[ATTORNEY: …]" markers have no "(url)" and stay text.
      if (close > i && end > close) {
        flush()
        out.push({ kind: 'link', href: src.slice(close + 2, end), children: parseInline(src.slice(i + 1, close)) })
        i = end + 1
        continue
      }
    }
    buf += src[i]
    i += 1
  }
  flush()
  return out
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

const SEPARATOR_ROW = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/

export function parseLegalMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ kind: 'rule' })
      i += 1
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4
      blocks.push({ kind: 'heading', level, children: parseInline(heading[2]), id: slugifyHeading(heading[2]) })
      i += 1
      continue
    }

    if (trimmed.startsWith('>')) {
      const inner: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        inner.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ kind: 'quote', children: parseLegalMarkdown(inner.join('\n')) })
      continue
    }

    if (trimmed.startsWith('|') && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1].trim())) {
      const header = splitRow(trimmed).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]).map(parseInline))
        i += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const bullet = /^[-*]\s+(.*)$/
    const numbered = /^\d+\.\s+(.*)$/
    if (bullet.test(trimmed) || numbered.test(trimmed)) {
      const ordered = numbered.test(trimmed)
      const matcher = ordered ? numbered : bullet
      const items: Inline[][] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const m = matcher.exec(t)
        if (!m) {
          // A wrapped continuation line (indented, not a new item) joins the item.
          if (t && /^\s+/.test(lines[i]) && items.length) {
            const last = items[items.length - 1]
            last.push({ kind: 'text', text: ' ' }, ...parseInline(t))
            i += 1
            continue
          }
          break
        }
        items.push(parseInline(m[1]))
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // Paragraph: consecutive non-blank lines that start nothing else.
    const para: string[] = [trimmed]
    i += 1
    while (i < lines.length) {
      const t = lines[i].trim()
      if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('```') || /^-{3,}$/.test(t) || bullet.test(t) || numbered.test(t)) break
      para.push(t)
      i += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(para.join(' ')) })
  }

  return blocks
}

/** The "**Version:** vX" line every legal document carries, or null. */
export function extractVersionLine(markdown: string): string | null {
  const m = /\*\*Version:\*\*\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(markdown)
  return m ? m[1] : null
}

/** The first "# Title" line, or null. */
export function extractTitle(markdown: string): string | null {
  const m = /^#\s+(.+)$/m.exec(markdown)
  return m ? m[1].trim() : null
}
