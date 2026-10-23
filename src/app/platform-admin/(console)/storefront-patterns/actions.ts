"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { recordAudit, requestContext } from "@/modules/platform-admin/audit";
import { reviewPatternCandidate } from "@/modules/storefront-learning/patterns";

const ReviewSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["APPROVED", "REJECTED", "RETIRED"]),
  note: z.string().max(500).optional(),
});

/** Platform review — the only path by which a detected pattern becomes usable. */
export async function reviewPatternAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin("ai.manage");
  const input = ReviewSchema.parse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    note: (formData.get("note") as string | null) || undefined,
  });
  await reviewPatternCandidate(input.id, input.decision, admin.adminId, input.note);
  await recordAudit(
    { category: "ADMIN_ACTION", action: `storefront_pattern_${input.decision.toLowerCase()}`, actor: { type: "platform_admin", id: admin.adminId }, resource: { type: "storefront_pattern", id: input.id }, reason: input.note ?? null, ...(await requestContext()) },
    { strict: true },
  );
  revalidatePath("/platform-admin/storefront-patterns");
}
