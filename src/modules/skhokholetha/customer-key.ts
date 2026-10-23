/**
 * Issuing the customer's own delivery key (see codes.ts). Idempotent: a
 * retried checkout gets the SAME key back, so a customer whose first response
 * was lost still holds a working key.
 */

import { prisma } from '@/lib/prisma/client'
import { deriveCustomerKey, hashTrackingToken, newCodeNonce } from './codes'

export async function issueCustomerDeliveryKey(orderDeliveryId: string): Promise<string> {
  const nonce = newCodeNonce()
  // Only the first issue writes; a concurrent or repeated call keeps the stored nonce.
  await prisma.orderDelivery.updateMany({
    where: { id: orderDeliveryId, customerKeyNonce: null },
    data: { customerKeyNonce: nonce, customerKeyHash: hashTrackingToken(deriveCustomerKey(orderDeliveryId, nonce)) },
  })
  const row = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: orderDeliveryId }, select: { customerKeyNonce: true } })
  return deriveCustomerKey(orderDeliveryId, row.customerKeyNonce!)
}
