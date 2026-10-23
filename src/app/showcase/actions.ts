"use server";

import { prisma } from "@/lib/prisma/client";
import { normalizeSAPhone } from "@/lib/utils";

export type EnquiryResult = { ok: true } | { ok: false; error: string };

export interface EnquiryInput {
  interest: string;
  name: string;
  phone: string;
  email?: string;
  businessName?: string;
  message?: string;
}

/**
 * Writes one `PlatformEnquiry` row. Public visitors (no session) always get
 * `businessId: null` — this route never sees a signed-in tenant, so there is
 * nothing to attach. `source` is fixed to "showcase" per the task spec; the
 * caller only ever sets `interest` to a plan name (STARTER…) or a service
 * slug (website, whatsapp-ordering, voice-agent, content, speed-to-lead).
 */
export async function submitEnquiry(input: EnquiryInput): Promise<EnquiryResult> {
  const name = input.name.trim();
  const phoneRaw = input.phone.trim();
  const email = input.email?.trim();
  const businessName = input.businessName?.trim();
  const message = input.message?.trim();

  if (!name) return { ok: false, error: "Enter your name." };
  if (!phoneRaw) return { ok: false, error: "Enter your phone number." };
  if (!input.interest) {
    return { ok: false, error: "Something went wrong. Try again." };
  }

  // Best-effort normalise to +27… for a clean record; an enquiry is lower
  // stakes than the customer identity core, so an unparseable number still
  // gets saved as typed rather than rejected outright.
  const phone = normalizeSAPhone(phoneRaw) ?? phoneRaw;

  try {
    await prisma.platformEnquiry.create({
      data: {
        name,
        phone,
        email: email || undefined,
        businessName: businessName || undefined,
        message: message || undefined,
        interest: input.interest,
        source: "showcase",
      },
    });
  } catch (e) {
    console.error("[showcase] enquiry error:", e);
    return { ok: false, error: "Could not send that. Try again." };
  }

  return { ok: true };
}
