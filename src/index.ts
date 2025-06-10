import express from 'express';
import { Bot, webhookCallback } from 'grammy';
import 'dotenv/config';
import { usernameTyposquatDetector } from './detectors/username';
import { intentClassificationDetector } from './detectors/intent';
import { deletionSpikeDetector } from './detectors/deletion';
import { profilePicSimilarityDetector, loadAdminImages } from './detectors/profilepic';

// 1. Create a bot
export const bot = new Bot(process.env.BOT_TOKEN!);

async function main() {
  // 1.5 Preload all admin images
  await loadAdminImages();

  // 2. Register your detectors as middleware
  bot.use(usernameTyposquatDetector);
  bot.use(intentClassificationDetector);
  bot.use(deletionSpikeDetector);
  bot.use(profilePicSimilarityDetector);

  // 3. Webhook setup
  const app = express();
  app.use(express.json());
  app.post('/webhook', webhookCallback(bot, 'express'));

  // 4. Start listening
  const PORT = Number(process.env.PORT) || 3000;
  const url  = `${process.env.WEBHOOK_URL}/webhook`;

  // set the webhook before starting to serve
  await bot.api.setWebhook(url, { drop_pending_updates: true });

  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}/webhook`);
    console.log(`Webhook set to ${url}`);
  });
}

// Kick it off
main().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});
