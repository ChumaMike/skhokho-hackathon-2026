import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/guards'
import { exportCustomerData, DataSubjectError } from '@/modules/privacy/data-subject.service'
import { recordAudit, requestContext } from '@/modules/platform-admin/audit'

export const runtime = 'nodejs'

const Query = z.object({ business: z.string().uuid(), publicId: z.string().uuid(), phone: z.string().min(10).max(20).optional() })

/**
 * One customer's record at one business, as a JSON download — the access
 * request. Same admin gate as the page; the export itself is recorded as a
 * data-subject request by the service and audited here.
 */
export async function GET(req: NextRequest) {
  let admin
  try {
    admin = await requireAdmin('privacy.manage')
  } catch {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  const { business, publicId, phone } = parsed.data
  try {
    const data = await exportCustomerData(business, publicId, { type: 'platform_admin', id: admin.adminId }, phone)
    if (!data) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    await recordAudit({
      category: 'ADMIN_ACTION',
      action: 'customer_data_exported',
      actor: { type: 'platform_admin', id: admin.adminId },
      businessId: business,
      resource: { type: 'membership', id: publicId },
      metadata: { role: admin.role },
      ...(await requestContext()),
    })
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="customer-${publicId}.json"`,
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    if (e instanceof DataSubjectError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 })
    throw e
  }
}
