"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma/client";
import { adminCommand, AdminCommandError } from "@/modules/platform-admin/command";
import { approveDriver, rejectDriver, reinstateDriver, reviewDriverDocument, suspendDriver } from "@/modules/skhokholetha/driver.service";
import { addLedgerAdjustment, createDriverPayout, markPayoutFailed, markPayoutPaid } from "@/modules/skhokholetha/ledger.service";
import { cancelNetworkDelivery, openDispute } from "@/modules/skhokholetha/delivery.service";

/**
 * Skhokholetha admin commands. Each is explicit, permission-checked, needs a
 * reason (stored in the audit log) and is recorded as an ADMIN_ACTION.
 */

const id = z.string().min(1).max(64);

export async function reviewDocumentAction(driverId: string, documentId: string, decision: "ACCEPTED" | "REJECTED", fd: FormData) {
  const did = id.parse(driverId);
  await adminCommand({ permission: "drivers.documents", path: `/platform-admin/drivers/${did}`, reasonRequired: decision === "REJECTED" }, fd, async (admin, reason) => {
    if (decision !== "ACCEPTED" && decision !== "REJECTED") throw new AdminCommandError("Invalid decision.");
    // The document must belong to this driver — never review across applications.
    const doc = await prisma.driverDocument.findFirst({ where: { id: id.parse(documentId), driverId: did }, select: { id: true, kind: true } });
    if (!doc) throw new AdminCommandError("Document not found.");
    await reviewDriverDocument(admin.adminId, doc.id, decision, reason ?? undefined);
    return { action: decision === "ACCEPTED" ? "driver_document_accepted" : "driver_document_rejected", resource: { type: "driver_document", id: doc.id }, metadata: { driverId: did, kind: doc.kind } };
  });
}

const DECISIONS = { APPROVE: "driver_approved", REJECT: "driver_rejected", SUSPEND: "driver_suspended", REINSTATE: "driver_reinstated" } as const;

export async function decideDriverAction(driverId: string, decision: keyof typeof DECISIONS, fd: FormData) {
  const did = id.parse(driverId);
  await adminCommand({ permission: "drivers.manage", path: `/platform-admin/drivers/${did}` }, fd, async (admin, reason) => {
    if (!(decision in DECISIONS)) throw new AdminCommandError("Invalid decision.");
    if (decision === "APPROVE") await approveDriver(admin.adminId, did);
    else if (decision === "REJECT") await rejectDriver(admin.adminId, did, reason!);
    else if (decision === "SUSPEND") await suspendDriver(admin.adminId, did, reason!);
    else await reinstateDriver(admin.adminId, did);
    return { action: DECISIONS[decision], resource: { type: "driver", id: did } };
  });
}

export async function adjustLedgerAction(driverId: string, fd: FormData) {
  const did = id.parse(driverId);
  await adminCommand({ permission: "payouts.manage", path: `/platform-admin/drivers/${did}` }, fd, async (admin, reason) => {
    const rands = Number(String(fd.get("amountRands") ?? "").replace(",", "."));
    if (!Number.isFinite(rands) || rands === 0) throw new AdminCommandError("Enter the amount in rand, e.g. 25.00 or -10.50.");
    const amountCents = Math.round(rands * 100);
    const key = String(fd.get("idempotencyKey") ?? "");
    const entry = await addLedgerAdjustment(admin.adminId, did, { amountCents, reason: reason!, reference: String(fd.get("reference") ?? ""), idempotencyKey: key });
    return { action: "ledger_adjustment_added", resource: { type: "driver_ledger_entry", id: entry.id }, metadata: { driverId: did, amountCents, reference: entry.reference } };
  });
}

export async function createPayoutAction(driverId: string, fd: FormData) {
  const did = id.parse(driverId);
  await adminCommand({ permission: "payouts.manage", path: "/platform-admin/payouts", reasonRequired: false }, fd, async (admin) => {
    const payout = await createDriverPayout(admin.adminId, did);
    return { action: "payout_created", resource: { type: "driver_payout", id: payout.id }, metadata: { driverId: did, amountCents: payout.amountCents } };
  });
}

export async function settlePayoutAction(payoutId: string, outcome: "PAID" | "FAILED", fd: FormData) {
  const pid = id.parse(payoutId);
  await adminCommand({ permission: "payouts.manage", path: "/platform-admin/payouts", reasonRequired: outcome === "FAILED" }, fd, async (admin, reason) => {
    const reference = String(fd.get("reference") ?? "").trim();
    if (outcome === "PAID") await markPayoutPaid(admin.adminId, pid, reference);
    else await markPayoutFailed(admin.adminId, pid, reason ?? "Failed");
    return { action: outcome === "PAID" ? "payout_marked_paid" : "payout_marked_failed", resource: { type: "driver_payout", id: pid }, metadata: { reference: reference || undefined } };
  });
}

export async function interveneDeliveryAction(deliveryId: string, action: "CANCEL" | "DISPUTE", fd: FormData) {
  const nid = id.parse(deliveryId);
  await adminCommand({ permission: "deliveries.intervene", path: `/platform-admin/deliveries/${nid}` }, fd, async (admin, reason) => {
    const d = await prisma.networkDelivery.findUnique({ where: { id: nid }, select: { businessId: true } });
    if (!d) throw new AdminCommandError("Delivery not found.");
    if (action === "CANCEL") await cancelNetworkDelivery({ type: "ADMIN", id: admin.adminId }, nid, reason!);
    else if (action === "DISPUTE") await openDispute(admin.adminId, nid, reason!);
    else throw new AdminCommandError("Unknown command.");
    return { action: action === "CANCEL" ? "delivery_cancelled_by_admin" : "delivery_dispute_opened", resource: { type: "network_delivery", id: nid }, businessId: d.businessId };
  });
}

