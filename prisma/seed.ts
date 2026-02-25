import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const chats = [-1001234n, -1005678n];

  for (const chatId of chats) {
    await prisma.groupState.upsert({
      where: { chatId },
      update: {},
      create: {
        chatId,
        title: `Chat_${chatId}`,
        chatType: 'supergroup',
        isActive: true,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
