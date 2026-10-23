import { NextRequest, NextResponse } from 'next/server'
import { requireDriverSession } from '@/lib/auth/guards'
import { uploadDriverDocument, MAX_DOCUMENT_BYTES } from '@/modules/skhokholetha/driver.service'
import { lethaError } from '@/modules/skhokholetha/http'
import { checkRateLimits } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** A driver uploads one of their own documents. Stored privately (database), never public. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireDriverSession()
    const limited = await checkRateLimits([['documentUploadDriver', session.driverId]])
    if (!limited.allowed) return NextResponse.json({ ok: false, error: 'Too many uploads — try again later.' }, { status: 429 })
    const declared = Number(req.headers.get('content-length') ?? 0)
    if (declared > MAX_DOCUMENT_BYTES + 64 * 1024) return NextResponse.json({ ok: false, error: 'Files must be 5 MB or smaller.' }, { status: 413 })
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Choose a file to upload.' }, { status: 400 })
    const doc = await uploadDriverDocument(session.driverId, {
      kind: String(form.get('kind') ?? ''),
      fileName: file.name,
      contentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      expiresOn: (form.get('expiresOn') as string | null) || null,
    })
    return NextResponse.json({ ok: true, document: doc })
  } catch (e) {
    return lethaError(e)
  }
}
