import { Middleware } from "grammy";
import axios from "axios";
import { OpenAI, RateLimitError } from "openai";
import { bot } from "../index";

// ─── Configuration ──────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN!;
const OPENAI_KEY = process.env.OPENAI_API_KEY!;
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID!);
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "")
  .split(",")
  .map(s => Number(s.trim()))
  .filter(Boolean);
const SIMILARITY_THRESHOLD = 0.8;

// ─── OpenAI client ──────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ─── In-memory cache for admin images ────────────────────────────────────────────
const adminImages: Record<number, Buffer> = {};

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function fetchProfilePhotoBuffer(userId: number): Promise<Buffer|undefined> {
  try {
    const photos = await bot.api.getUserProfilePhotos(userId, { limit: 1 });
    if (!photos.total_count) return;
    const fileId = photos.photos[0][0].file_id;
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) {
      console.warn(`No file_path for user ${userId}`);
      return;
    }
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch (error) {
    console.error(`Error fetching profile photo for ${userId}:`, error);
    return;
  }
}

async function compareImages(a: Buffer, b: Buffer): Promise<number> {
  const b64a = a.toString("base64");
  const b64b = b.toString("base64");
  try {
    // Ask model for raw JSON without markdown
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an assistant that compares two face photos. Respond only with raw JSON of the form { \"similarity\": <number> } without any markdown or code fences."
        },
        {
          role: "user",
          content:
            `Image A: data:image/jpeg;base64,${b64a}\n\n` +
            `Image B: data:image/jpeg;base64,${b64b}`
        }
      ]
    });

    const choice = res.choices?.[0];
    if (!choice?.message?.content) {
      console.error("No content from OpenAI response", res);
      return 0;
    }

    // Clean markdown fences if any
    let raw = choice.message.content.trim();
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```$/g, "");

    const obj = JSON.parse(raw);
    return +obj.similarity || 0;
  } catch (e: unknown) {
    // Narrow unknown to any for error inspection
    const err = e as any;
    if (err instanceof RateLimitError || err.error?.type === 'insufficient_quota') {
      console.warn("OpenAI quota or rate limit reached, skipping comparison");
      return 0;
    }
    console.error("Error comparing images:", err);
    return 0;
  }
}

// ─── Preload admin pics on startup ──────────────────────────────────────────────
export async function loadAdminImages() {
  for (const adminId of ADMIN_USER_IDS) {
    console.log("Loading admin image for", adminId);
    const buf = await fetchProfilePhotoBuffer(adminId);
    if (buf) {
      adminImages[adminId] = buf;
      console.log("Loaded image for admin", adminId);
    } else {
      console.warn("Failed to load image for admin", adminId);
    }
  }
}

// ─── The middleware itself ─────────────────────────────────────────────────────
export const profilePicSimilarityDetector: Middleware = async (ctx, next) => {
  const newMembers = ctx.update.message?.new_chat_members;
  if (newMembers?.length) {
    for (const newUser of newMembers) {
      console.log("🔔 New user joined:", newUser.id, newUser.first_name);
      const userBuf = await fetchProfilePhotoBuffer(newUser.id);
      if (!userBuf) {
        console.log("   – no profile pic for", newUser.id);
        continue;
      }
      for (const adminId of ADMIN_USER_IDS) {
        const adminBuf = adminImages[adminId];
        if (!adminBuf) {
          console.log("   – no cached admin image for", adminId);
          continue;
        }
        console.log(`   – comparing ${newUser.id} against admin ${adminId}…`);
        const sim = await compareImages(userBuf, adminBuf);
        console.log("     → similarity =", sim);
        if (sim >= SIMILARITY_THRESHOLD) {
          await bot.api.sendMessage(
            ADMIN_CHAT_ID,
            `🚨 *Impersonation alert!* User [${newUser.first_name}](tg://user?id=${newUser.id}) ` +
            `is *${Math.round(sim*100)}%* similar to admin \`${adminId}\`.`,
            { parse_mode: "Markdown" }
          );
          break;
        }
      }
    }
  }

  await next();
};
