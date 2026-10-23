import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma/client'
import { clientIp } from '@/lib/rate-limit'
import { recordAudit } from '@/modules/platform-admin/audit'

export const runtime = 'nodejs'

/**
 * The ONLY way a driver document's bytes leave the database: an admin whose
 * role holds drivers.documents (higher than viewing drivers), with an MFA
 * session, one document at a time, as a download (never rendered inline),
 * never cached — and every download is an audit event. Anyone else: 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  let admin
  try {
    admin = await requireAdmin('drivers.documents')
  } catch (e) {
    if (e instanceof AuthError) return new NextResponse('Not found', { status: 404 })
    throw e
  }
  const { documentId } = await params
  const doc = await prisma.driverDocument.findUnique({ where: { id: documentId }, select: { id: true, driverId: true, kind: true, content: true, contentType: true, fileName: true } })
  if (!doc) return new NextResponse('Not found', { status: 404 })
  // Strict: if we can't record who looked, the document isn't served.
  await recordAudit(
    {
      category: 'ADMIN_ACTION',
      action: 'driver_document_downloaded',
      actor: { type: 'platform_admin', id: admin.adminId },
      resource: { type: 'driver_document', id: doc.id },
      metadata: { driverId: doc.driverId, kind: doc.kind },
      ip: clientIp(req),
      requestId: req.headers.get('x-request-id'),
    },
    { strict: true },
  )
  return new NextResponse(Buffer.from(doc.content), {
    headers: {
      'content-type': doc.contentType,
      'content-disposition': `attachment; filename="${doc.fileName.replace(/"/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}
