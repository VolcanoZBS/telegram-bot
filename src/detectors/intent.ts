import { Context, NextFunction } from 'grammy';

// Patterns indicating a private solicitation
const TRIGGER_PATTERNS: RegExp[] = [
  /\bdm\b/i,
  /\bpm\b/i,
  /\bdm me\b/i,
  /\bplease dm\b/i,
  /\bpm me\b/i,
  /\bplease pm\b/i,
  /\bprivate message\b/i,
  /\bmessage me\b/i,
];

export async function intentClassificationDetector(ctx: Context, next: NextFunction) {
  const text = ctx.message?.text;
  if (!text) {
    return next();
  }

  for (const pattern of TRIGGER_PATTERNS) {
    if (pattern.test(text)) {
      const username = ctx.from?.username || `${ctx.from?.first_name} ${ctx.from?.last_name ?? ''}`;
      const alert = `🚨 Private solicitation detected from @${username}: "${text}"`;
      await ctx.api.sendMessage(process.env.ADMIN_CHAT_ID!, alert);
      break; // alert once per message
    }
  }

  return next();
}

