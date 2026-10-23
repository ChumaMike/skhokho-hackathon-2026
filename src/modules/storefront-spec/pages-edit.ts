/**
 * The owner's edits to their page list — pure functions over SitePage[]
 * that the dashboard actions call before handing the whole list to
 * editDraftSite (which validates it with SiteSchema). Keeping the moves
 * here means the rules ("you can't delete About", "home stays first") are
 * testable without a form.
 */

import { z } from 'zod'
import {
  PAGE_LIMITS,
  PageSectionSchema,
  RESERVED_PAGE_SLUGS,
  addableSectionTypes,
  coreSectionType,
  newCustomPage,
  pageSlug,
  type PageSection,
  type PageSectionType,
  type SitePage,
} from './pages'
import { specText } from './spec-text'

export class PageEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageEditError'
  }
}

/** Fields an owner may change on any page's header. */
export const PageHeaderEditSchema = z
  .object({
    title: specText(PAGE_LIMITS.title),
    slug: pageSlug.optional(),
    visible: z.boolean(),
    inNav: z.boolean(),
    inFooter: z.boolean(),
    /** Search listing; an empty string clears the field. */
    seoTitle: z.string().trim().max(PAGE_LIMITS.seoTitle).optional(),
    seoDescription: z.string().trim().max(PAGE_LIMITS.seoDescription).optional(),
  })
  .strict()
export type PageHeaderEdit = z.infer<typeof PageHeaderEditSchema>

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAGE_LIMITS.slug)
}

export function movePage(pages: SitePage[], id: string, direction: 'up' | 'down'): SitePage[] {
  const index = pages.findIndex((p) => p.id === id)
  if (index < 0) throw new PageEditError('That page no longer exists.')
  const target = direction === 'up' ? index - 1 : index + 1
  // Home stays first: nothing moves above it and it never moves.
  if (pages[index].kind === 'HOME' || target < 1 || target >= pages.length) return pages
  const next = [...pages]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function updatePageHeader(pages: SitePage[], id: string, edit: PageHeaderEdit): SitePage[] {
  const page = pages.find((p) => p.id === id)
  if (!page) throw new PageEditError('That page no longer exists.')
  const slugEditable = page.kind === 'POLICY' || page.kind === 'CUSTOM'
  const slug = slugEditable ? (edit.slug ?? page.slug) : page.slug
  if (slugEditable && (!slug || RESERVED_PAGE_SLUGS.has(slug))) throw new PageEditError(`/${slug || ''} can't be used as a page address.`)
  if (pages.some((p) => p.id !== id && p.kind !== 'HOME' && p.slug === slug)) throw new PageEditError(`Another page already uses /${slug}.`)
  const seoTitle = edit.seoTitle === undefined ? page.seo?.title : edit.seoTitle || undefined
  const seoDescription = edit.seoDescription === undefined ? page.seo?.description : edit.seoDescription || undefined
  const seo = seoTitle || seoDescription ? { ...(seoTitle ? { title: seoTitle } : {}), ...(seoDescription ? { description: seoDescription } : {}) } : undefined
  return pages.map((p) =>
    p.id === id
      ? {
          ...p,
          title: edit.title,
          slug,
          visible: page.kind === 'HOME' ? true : edit.visible,
          inNav: page.kind === 'HOME' ? true : edit.inNav,
          inFooter: page.kind === 'HOME' ? false : edit.inFooter,
          ...(seo ? { seo } : {}),
          ...(!seo && p.seo ? { seo: undefined } : {}),
        }
      : p,
  ).map((p) => {
    // Never store an explicit undefined: the strict schema wants the key absent.
    if (p.seo === undefined && 'seo' in p) {
      const { seo: _omit, ...rest } = p
      void _omit
      return rest as SitePage
    }
    return p
  })
}

export function addCustomPage(pages: SitePage[], title: string, slugInput?: string): SitePage[] {
  if (pages.length >= PAGE_LIMITS.pages) throw new PageEditError(`You can have up to ${PAGE_LIMITS.pages} pages.`)
  const parsedTitle = specText(PAGE_LIMITS.title).safeParse(title)
  if (!parsedTitle.success) throw new PageEditError('Give the page a short name.')
  const slug = pageSlug.safeParse(slugInput?.trim() || slugFromTitle(parsedTitle.data))
  if (!slug.success || !slug.data) throw new PageEditError('Use lowercase letters, numbers and dashes for the web address.')
  if (RESERVED_PAGE_SLUGS.has(slug.data)) throw new PageEditError(`/${slug.data} is reserved — pick another address.`)
  if (pages.some((p) => p.slug === slug.data)) throw new PageEditError(`Another page already uses /${slug.data}.`)
  if (pages.some((p) => p.id === `page-${slug.data}`)) throw new PageEditError(`Another page already uses /${slug.data}.`)
  return [...pages, newCustomPage(parsedTitle.data, slug.data)]
}

export function removePage(pages: SitePage[], id: string): SitePage[] {
  const page = pages.find((p) => p.id === id)
  if (!page) throw new PageEditError('That page no longer exists.')
  if (page.kind !== 'CUSTOM') throw new PageEditError(`"${page.title}" is a built-in page — hide it instead of deleting it.`)
  return pages.filter((p) => p.id !== id)
}

/** A section as the editor form posts it, before it becomes a PageSection. */
export interface SectionInput {
  type: PageSectionType
  heading?: string | null
  body?: string
  /** FAQ: blocks separated by a blank line; first line is the question, the rest the answer. */
  faq?: string
  /** ACTION: which request form. */
  workflow?: string
  /** GALLERY / REVIEWS / CATALOGUE: a layout option (pages.ts sectionLayoutOptions); '' = default. */
  layout?: string
}

export function sectionFromInput(input: SectionInput): PageSection {
  let candidate: unknown
  const layout = input.layout?.trim() ? { layout: input.layout.trim() } : {}
  switch (input.type) {
    case 'TEXT':
      candidate = { type: 'TEXT', heading: input.heading?.trim() ? input.heading.trim() : null, body: input.body ?? '' }
      break
    case 'ACTION':
      candidate = { type: 'ACTION', workflow: input.workflow }
      break
    case 'GALLERY':
    case 'REVIEWS':
    case 'CATALOGUE':
      candidate = { type: input.type, ...layout }
      break
    case 'FAQ': {
      const items = (input.faq ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) => {
          const [q, ...rest] = block.split('\n')
          return { q: q.trim(), a: rest.join('\n').trim() }
        })
      candidate = { type: 'FAQ', items }
      break
    }
    default:
      candidate = { type: input.type }
  }
  const parsed = PageSectionSchema.safeParse(candidate)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = input.type === 'FAQ' ? 'Each question needs a line for the question and at least one line for the answer' : input.type === 'ACTION' ? 'Choose which request form' : 'That text'
    throw new PageEditError(`${where}: ${issue?.message ?? 'could not be saved'}.`)
  }
  return parsed.data
}

/** Replaces a page's sections (already parsed), keeping the page's core section present. */
export function setPageSections(pages: SitePage[], id: string, sections: PageSection[]): SitePage[] {
  const page = pages.find((p) => p.id === id)
  if (!page) throw new PageEditError('That page no longer exists.')
  if (page.kind === 'HOME') throw new PageEditError('The home page is arranged in the design wizard.')
  if (sections.length > PAGE_LIMITS.sectionsPerPage) throw new PageEditError(`A page can have up to ${PAGE_LIMITS.sectionsPerPage} sections.`)
  const core = coreSectionType(page.kind)
  if (core && !sections.some((s) => s.type === core)) throw new PageEditError(`"${page.title}" needs its ${core.toLowerCase().replace('_', ' ')} section.`)
  const allowed = new Set<PageSectionType>([...addableSectionTypes(page.kind), ...(core ? [core] : []), 'PRIVACY_POINTER'])
  for (const s of sections) {
    if (!allowed.has(s.type)) throw new PageEditError(`A ${s.type.toLowerCase().replace('_', ' ')} section doesn't belong on this page.`)
  }
  return pages.map((p) => (p.id === id ? { ...p, sections } : p))
}

export function addSection(pages: SitePage[], id: string, input: SectionInput): SitePage[] {
  const page = pages.find((p) => p.id === id)
  if (!page) throw new PageEditError('That page no longer exists.')
  if (!addableSectionTypes(page.kind).includes(input.type)) throw new PageEditError('That kind of section can’t be added here.')
  return setPageSections(pages, id, [...page.sections, sectionFromInput(input)])
}
