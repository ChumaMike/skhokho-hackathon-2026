import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { safeReturnPath } from '@/lib/utils'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { checkRateLimits, clientIp, honeypotTripped, HONEYPOT_FIELD, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { getBusinessCapabilities } from '@/modules/tenant/capabilities'
import { ImageUploadError, uploadCatalogImage } from '@/lib/blob'
import { activeWorkflowsFor } from '@/modules/storefront-workflows/access'
import { LEAD_LIMITS, isWorkflowId, parseLead } from '@/modules/storefront-workflows/workflows'
import { createLead } from '@/modules/storefront-workflows/leads.service'

export const runtime = 'nodejs'

/**
 * A storefront request form (quote / enquiry / pickup / callback). Public,
 * like /api/store/book, so the same defences apply: honeypot, per-IP rate
 * limit, the host may only act on its own business, only ACTIVE businesses,
 * and only workflows that business can run today (capability AND plan).
 * Photos (quote requests only) go to the business's own image store with
 * the catalogue's type and size rules. Always redirects back to the page
 * the form was on, with a fixed success key or a plain error.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const businessId = (form.get('businessId') ?? '').toString()
  const workflowId = (form.get('workflow') ?? '').toString()
  const returnTo = safeReturnPath((form.get('returnTo') ?? '/').toString())
  const pageSlug = (form.get('pageSlug') ?? '').toString().slice(0, 40)
  const consent = form.get('consent') === 'on'

  const back = (err: string) => NextResponse.redirect(new URL(`${returnTo}?err=${encodeURIComponent(err)}`, req.url), 303)

  if (honeypotTripped(form.get(HONEYPOT_FIELD))) return back('Something went wrong. Try again.')
  const limited = await checkRateLimits([['leadIp', clientIp(req)]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)
  if (!consent) return back('Please accept the terms to continue.')
  if (!isWorkflowId(workflowId)) return back('That request form is not available.')
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) return back('That request form is not available.')
  if (await hostTenantConflict(req, businessId)) return back('That request form is not available.')

  const business = await prisma.business.findFirst({ where: { id: businessId, status: 'ACTIVE' }, select: { id: true, category: true, settings: true } })
  if (!business) return back('That request form is not available.')
  const workflows = await activeWorkflowsFor(business.id, getBusinessCapabilities(business))
  if (!workflows.includes(workflowId)) return back('That request form is not available.')

  const raw: Record<string, unknown> = {}
  for (const [key, value] of form.entries()) if (typeof value === 'string') raw[key] = value
  const parsed = parseLead(workflowId, raw)
  if (!parsed.ok) return back(parsed.error)

  const photos: string[] = []
  if (parsed.lead.workflow.photos) {
    const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, LEAD_LIMITS.photos)
    for (const file of files) {
      try {
        photos.push(await uploadCatalogImage(file, business.id, 'business'))
      } catch (e) {
        if (e instanceof ImageUploadError) return back(e.message)
        console.error('[store/lead] photo upload failed', e)
        return back('One of the photos could not be uploaded. Try again without it.')
      }
    }
  }

  try {
    await createLead(business.id, parsed.lead, { photos, pageSlug, ip: clientIp(req) })
  } catch (e) {
    console.error('[store/lead] could not save', e)
    return back('Your request could not be sent. Please try again, or WhatsApp the business.')
  }
  return NextResponse.redirect(new URL(`${returnTo}?ok=lead`, req.url), 303)
}
