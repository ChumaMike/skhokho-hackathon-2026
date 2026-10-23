/**
 * Delivery events: the append-only history of a network delivery (the table
 * has an UPDATE-blocking trigger). Every state change, offer, verification
 * and admin intervention writes one row, so a delivery can be reconstructed
 * step by step. Never pass codes, tokens or bank details in `data`.
 */

import type { NetworkDeliveryStatus, Prisma } from '@prisma/client'
import type { DeliveryActorType } from './state-machine'

const FORBIDDEN_KEYS = /code|token|secret|password|account|nonce/i

export interface DeliveryEventInput {
  networkDeliveryId: string
  businessId: string
  type: string
  fromStatus?: NetworkDeliveryStatus | null
  toStatus?: NetworkDeliveryStatus | null
  actorType: DeliveryActorType | 'CUSTOMER'
  actorId?: string | null
  data?: Record<string, unknown>
}

/** Strips anything that looks secret, defensively, before it's written. */
export function safeEventData(data: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!data) return undefined
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) if (!FORBIDDEN_KEYS.test(k)) clean[k] = v
  return clean as Prisma.InputJsonValue
}

export async function recordDeliveryEvent(tx: Prisma.TransactionClient, e: DeliveryEventInput): Promise<void> {
  await tx.deliveryEvent.create({
    data: {
      networkDeliveryId: e.networkDeliveryId,
      businessId: e.businessId,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actorType: e.actorType,
      actorId: e.actorId ?? null,
      data: safeEventData(e.data),
    },
  })
}
