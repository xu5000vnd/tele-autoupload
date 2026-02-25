import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as readline from 'readline';
import { config as loadEnv } from 'dotenv';

loadEnv();

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH ?? '';
const phoneNumber = process.env.TG_NUMBER ?? '';

if (!apiId || !apiHash) {
  console.error('❌ TG_API_ID and TG_API_HASH must be set in your .env file');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const prompt = (question: string): Promise<string> =>
  new Promise((resolve) => rl.question(question, resolve));

(async () => {
  console.log('🔑 Telegram Session Generator');
  console.log('──────────────────────────────');
  console.log(`Using API ID : ${apiId}`);
  console.log(`Using Number : ${phoneNumber || '(not set — will prompt)'}`);
  console.log('');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: phoneNumber || (() => prompt('📱 Phone number (with country code, e.g. +66812345678): ')),
    phoneCode: () => prompt('📨 Code received in Telegram app: '),
    password: () => prompt('🔒 2FA password (press Enter to skip): '),
    onError: (err) => {
      console.error('❌ Auth error:', err.message);
    },
  });

  const sessionString = client.session.save() as unknown as string;

  console.log('');
  console.log('✅ Session generated successfully!');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('Copy the line below into your .env file:');
  console.log('');
  console.log(`TG_SESSION_STRING=${sessionString}`);
  console.log('──────────────────────────────────────────────────────────────');

  rl.close();
  await client.disconnect();
})().catch((err) => {
  console.error('❌ Failed to generate session:', err.message);
  rl.close();
  process.exit(1);
});
