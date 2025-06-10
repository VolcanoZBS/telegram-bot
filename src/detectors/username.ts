import { Context, NextFunction } from 'grammy';

// List of admin usernames to compare against; set in .env as comma-separated
const ADMIN_USERNAMES: string[] = process.env.ADMIN_USERNAMES
  ? process.env.ADMIN_USERNAMES.split(',').map(u => u.trim().toLowerCase())
  : [];

// Threshold for Levenshtein distance to consider as typosquat
const DISTANCE_THRESHOLD = Number(process.env.TYPO_DISTANCE_THRESHOLD || '1');

// Levenshtein distance algorithm
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

export async function usernameTyposquatDetector(ctx: Context, next: NextFunction) {
  const newMembers = ctx.update.message?.new_chat_members;
  if (!newMembers?.length) return next();

  for (const member of newMembers) {
    const username = member.username?.toLowerCase();
    if (!username) continue;

    for (const admin of ADMIN_USERNAMES) {
      const distance = levenshtein(username, admin);
      if (distance > 0 && distance <= DISTANCE_THRESHOLD) {
        const alertMessage = `⚠️ Possible typosquat detected!\n` +
          `New user @${username} is similar to admin @${admin} (distance: ${distance}).`;
        await ctx.api.sendMessage(process.env.ADMIN_CHAT_ID!, alertMessage);
        break; // avoid multiple alerts per member
      }
    }
  }

  return next();
}
