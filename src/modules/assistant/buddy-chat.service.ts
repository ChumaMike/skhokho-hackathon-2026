import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma/client";
import type { StaffActor } from "@/lib/auth/guards";
import { askAssistant } from "./assistant.service";

const HISTORY_LIMIT = 100;

export interface BuddyMessageView {
  id: string;
  role: "owner" | "buddy";
  content: string;
  source: string | null;
  createdAt: Date;
}

/**
 * Whose conversations this person may see: only their own. Chats from before
 * conversations were per person (staffId NULL) may hold anything the owner
 * was told, so only an owner sees those.
 */
function conversationScope(actor: StaffActor): Prisma.AssistantConversationWhereInput {
  return actor.isOwner
    ? { businessId: actor.tenantId, OR: [{ staffId: actor.staffId }, { staffId: null }] }
    : { businessId: actor.tenantId, staffId: actor.staffId };
}

/** This person's scroll-back history with their buddy, oldest first. */
export async function getBuddyHistory(actor: StaffActor): Promise<BuddyMessageView[]> {
  const conversation = await prisma.assistantConversation.findFirst({
    where: conversationScope(actor),
    orderBy: { updatedAt: "desc" },
    select: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: { id: true, role: true, content: true, source: true, createdAt: true },
      },
    },
  });
  return (conversation?.messages ?? []).reverse().map((m) => ({
    ...m,
    role: m.role === "owner" ? "owner" : "buddy",
  }));
}

/**
 * Stores the person's question, answers it from what THEIR role may see,
 * and stores the answer — in their own running conversation.
 */
export async function sendBuddyMessage(actor: StaffActor, question: string): Promise<BuddyMessageView> {
  let existing = await prisma.assistantConversation.findFirst({
    where: { businessId: actor.tenantId, staffId: actor.staffId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!existing && actor.isOwner) {
    // An owner carries on the business's pre-per-person chat, which becomes theirs.
    const legacy = await prisma.assistantConversation.findFirst({
      where: { businessId: actor.tenantId, staffId: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (legacy) {
      await prisma.assistantConversation.update({ where: { id: legacy.id }, data: { staffId: actor.staffId } });
      existing = legacy;
    }
  }
  const conversationId =
    existing?.id ??
    (await prisma.assistantConversation.create({ data: { businessId: actor.tenantId, staffId: actor.staffId }, select: { id: true } })).id;

  // "owner" is the stored role name for the human side of the chat, whoever they are.
  await prisma.assistantMessage.create({
    data: { conversationId, role: "owner", content: question },
  });

  const { text, source, href } = await askAssistant(actor, question);

  const reply = await prisma.assistantMessage.create({
    data: { conversationId, role: "buddy", content: href ? `${text}\n\n${href}` : text, source },
    select: { id: true, role: true, content: true, source: true, createdAt: true },
  });
  // Bump updatedAt so this stays the person's current conversation.
  await prisma.assistantConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  return { ...reply, role: "buddy" };
}
