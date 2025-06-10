import { Context, MiddlewareFn } from 'grammy';
import { GrammyError } from 'grammy';

// ─── Configuration ──────────────────────────────────────────────────────────────
const THRESHOLD = Number(process.env.DELETION_THRESHOLD ?? '3');
const CHECK_DELAY_MS = Number(process.env.DELETION_CHECK_DELAY_MS ?? '1000');
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID!);

// Track how many deletions each user has had
const deletionCounts: Record<number, number> = {};
// Ensure we only alert once per user per spike
const alerted = new Set<number>();

// Helper to probe deletion for a single message
async function probeDeletion(ctx: Context, userId: number, username: string | number, chatId: number, messageId: number) {
  try {
    const copy = await ctx.api.copyMessage(ADMIN_CHAT_ID, chatId, messageId, { disable_notification: true });
    await ctx.api.deleteMessage(ADMIN_CHAT_ID, copy.message_id);
  } catch (rawErr: unknown) {
    const err = rawErr as { message?: string };
    if (/not\s*found/i.test(err.message ?? '')) {
      deletionCounts[userId] = (deletionCounts[userId] || 0) + 1;
      console.log(`⚠️  ${username} deletions = ${deletionCounts[userId]}`);
      if (deletionCounts[userId] >= THRESHOLD && !alerted.has(userId)) {
        alerted.add(userId);
        await ctx.api.sendMessage(
          ADMIN_CHAT_ID,
          `⚠️ Deletion spike detected: ${username} deleted ${deletionCounts[userId]} messages.`
        );
      }
    } else {
      console.error(`Probe error for message ${messageId}:`, err.message ?? err);
    }
  }
}

export const deletionSpikeDetector: MiddlewareFn<Context> = async (ctx, next) => {
  const msg = ctx.message;
  if (!msg?.from) return next();

  const userId    = msg.from.id;
  const username  = msg.from.username ?? userId;
  const chatId    = msg.chat.id;
  const messageId = msg.message_id;

  console.log(`🕵️  Scheduling deletion probes for message ${messageId} from @${username}`);
  // Schedule two probes: one after CHECK_DELAY_MS, another later to catch slower deletions
  setTimeout(() => void probeDeletion(ctx, userId, username, chatId, messageId), CHECK_DELAY_MS);
  setTimeout(() => void probeDeletion(ctx, userId, username, chatId, messageId), CHECK_DELAY_MS * 5);

  return next();
};
