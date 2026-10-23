/**
 * One number for how big an uploaded image may be, shared by the form (so a
 * phone photo is refused before a slow upload starts), the Server Action
 * body limit in next.config.ts (so Next does not reject the whole form with
 * a bare "Body exceeded 1 MB limit" error page) and the storage layer.
 *
 * Why 4 MB: Vercel refuses any request body over 4.5 MB before our code
 * runs, and a Server Action form carries the other fields too. Next's own
 * default for Server Actions is 1 MB, which is smaller than most phone
 * photos — that default is what the pilot merchant hit on 2026-10-21 when
 * saving Settings with a logo on a slow connection: the upload crawled,
 * then failed with an error page instead of a sentence.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

/** The value next.config.ts hands to experimental.serverActions.bodySizeLimit — kept in step with MAX_UPLOAD_BYTES plus room for the text fields. */
export const SERVER_ACTION_BODY_LIMIT = '4500kb'

export function uploadTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_UPLOAD_BYTES
}

/** What the merchant reads when a photo is too big: the limit in plain MB and what to do. */
export function uploadTooLargeMessage(sizeBytes: number): string {
  const mb = (sizeBytes / (1024 * 1024)).toFixed(1)
  return `That image is ${mb} MB — please keep it under ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB. On a phone, choose a smaller size when sharing, or take a screenshot of the picture.`
}
