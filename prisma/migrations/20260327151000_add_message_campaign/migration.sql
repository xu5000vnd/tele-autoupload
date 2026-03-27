-- CreateEnum
CREATE TYPE "MessageCampaignStatus" AS ENUM ('pending', 'running', 'completed', 'partial_failed', 'failed');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('queued', 'sending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "message_campaign" (
    "id" TEXT NOT NULL,
    "body_template" TEXT NOT NULL,
    "created_by" TEXT,
    "status" "MessageCampaignStatus" NOT NULL DEFAULT 'pending',
    "total_targets" INTEGER NOT NULL DEFAULT 0,
    "success_targets" INTEGER NOT NULL DEFAULT 0,
    "failed_targets" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "message_campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_campaign_media" (
    "id" SERIAL NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT,
    "local_path" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_campaign_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_campaign_target" (
    "id" SERIAL NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "user_tu_id" INTEGER,
    "telegram_chat_id" BIGINT NOT NULL,
    "tu_name_snapshot" TEXT NOT NULL,
    "rendered_body" TEXT NOT NULL,
    "status" "MessageDeliveryStatus" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "message_campaign_target_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_campaign_created_at_idx" ON "message_campaign"("created_at");

-- CreateIndex
CREATE INDEX "message_campaign_media_campaign_id_order_index_idx" ON "message_campaign_media"("campaign_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "message_campaign_target_campaign_id_telegram_chat_id_key" ON "message_campaign_target"("campaign_id", "telegram_chat_id");

-- CreateIndex
CREATE INDEX "message_campaign_target_campaign_id_status_idx" ON "message_campaign_target"("campaign_id", "status");

-- AddForeignKey
ALTER TABLE "message_campaign_media" ADD CONSTRAINT "message_campaign_media_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "message_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_campaign_target" ADD CONSTRAINT "message_campaign_target_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "message_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_campaign_target" ADD CONSTRAINT "message_campaign_target_user_tu_id_fkey" FOREIGN KEY ("user_tu_id") REFERENCES "user_tu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
