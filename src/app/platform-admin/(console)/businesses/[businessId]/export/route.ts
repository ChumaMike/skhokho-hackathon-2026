import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/guards'
import { exportBusinessData } from '@/modules/privacy/data-subject.service'
import { recordAudit, requestContext } from '@/modules/platform-admin/audit'

export const runtime = 'nodejs'

/** The whole business's data as a JSON download (its access request) — recorded and audited. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ businessId: string }> }) {
  let admin
  try {
    admin = await requireAdmin('privacy.manage')
  } catch {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }
  const { businessId } = await params
  if (!z.string().uuid().safeParse(businessId).success) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  const data = await exportBusinessData(businessId, { type: 'platform_admin', id: admin.adminId })
  if (!data) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  await recordAudit({
    category: 'ADMIN_ACTION',
    action: 'business_data_exported',
    actor: { type: 'platform_admin', id: admin.adminId },
    businessId,
    resource: { type: 'business', id: businessId },
    metadata: { role: admin.role },
    ...(await requestContext()),
  })
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="business-${businessId}.json"`,
      'cache-control': 'no-store',
    },
  })
}
