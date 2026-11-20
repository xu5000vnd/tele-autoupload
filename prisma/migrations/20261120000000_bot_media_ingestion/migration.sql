-- CreateEnum
CREATE TYPE "MediaTransport" AS ENUM ('legacy', 'bot');

-- AlterTable
ALTER TABLE "media_item" ADD COLUMN     "album_id" TEXT,
ADD COLUMN     "bot_id" BIGINT,
ADD COLUMN     "source_revision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "transport" "MediaTransport" NOT NULL DEFAULT 'legacy';

-- CreateTable
CREATE TABLE "bot_receiver_state" (
    "bot_id" BIGINT NOT NULL,
    "lease_token" TEXT,
    "last_update_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_offset" INTEGER NOT NULL DEFAULT 0,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "last_poll_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_receiver_state_pkey" PRIMARY KEY ("bot_id")
);

-- CreateTable
CREATE TABLE "bot_update_inbox" (
    "id" BIGSERIAL NOT NULL,
    "bot_id" BIGINT NOT NULL,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "update_id" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "chat_id" BIGINT,
    "message_id" BIGINT,
    "message_date" TIMESTAMP(3),
    "sender_id" BIGINT,
    "sender_username" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_update_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_chat_capture" (
    "bot_id" BIGINT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "membership_status" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_chat_capture_pkey" PRIMARY KEY ("bot_id","chat_id")
);

-- CreateIndex
CREATE INDEX "bot_update_inbox_bot_id_status_id_idx" ON "bot_update_inbox"("bot_id", "status", "id");

-- CreateIndex
CREATE INDEX "bot_update_inbox_bot_id_chat_id_message_date_idx" ON "bot_update_inbox"("bot_id", "chat_id", "message_date");

-- CreateIndex
CREATE UNIQUE INDEX "bot_update_inbox_bot_id_epoch_update_id_key" ON "bot_update_inbox"("bot_id", "epoch", "update_id");
