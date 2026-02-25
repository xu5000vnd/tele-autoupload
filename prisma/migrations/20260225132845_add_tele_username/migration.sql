-- AlterTable
ALTER TABLE "user_tu" ADD COLUMN     "telegram_username" TEXT;

-- CreateIndex
CREATE INDEX "user_tu_telegram_username_telegram_chat_id_idx" ON "user_tu"("telegram_username", "telegram_chat_id");
