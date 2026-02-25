-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('group', 'supergroup', 'channel');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('photo', 'video', 'document');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('queued', 'downloading', 'downloaded', 'uploading', 'uploaded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "FilterMode" AS ENUM ('whitelist', 'blacklist');

-- CreateEnum
CREATE TYPE "UserTuStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "JobEventType" AS ENUM ('queued', 'download_start', 'download_done', 'upload_start', 'upload_done', 'failed', 'retried', 'skipped');

-- CreateTable
CREATE TABLE "group_state" (
    "chat_id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "chat_type" "ChatType" NOT NULL,
    "last_message_id" BIGINT NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_state_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "media_item" (
    "id" TEXT NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "message_id" BIGINT NOT NULL,
    "grouped_id" BIGINT,
    "media_index" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "sender_id" BIGINT,
    "media_type" "MediaType" NOT NULL,
    "mime_type" TEXT,
    "tg_file_id" TEXT NOT NULL,
    "tg_file_unique_id" TEXT,
    "file_name" TEXT,
    "sha256" TEXT,
    "local_path" TEXT,
    "size_bytes" BIGINT,
    "status" "MediaStatus" NOT NULL DEFAULT 'queued',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retry_at" TIMESTAMP(3),
    "drive_file_id" TEXT,
    "drive_web_url" TEXT,
    "error" TEXT,
    "failed_at" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drive_folder_map" (
    "chat_id" BIGINT NOT NULL,
    "drive_root_folder_id" TEXT NOT NULL,
    "drive_chat_folder_id" TEXT NOT NULL,
    "naming_template" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drive_folder_map_pkey" PRIMARY KEY ("chat_id")
);

-- CreateTable
CREATE TABLE "drive_date_folder_cache" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "date_path" TEXT NOT NULL,
    "drive_folder_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drive_date_folder_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_user_filter" (
    "id" SERIAL NOT NULL,
    "chat_id" BIGINT NOT NULL,
    "mode" "FilterMode" NOT NULL,
    "user_id" BIGINT NOT NULL,

    CONSTRAINT "group_user_filter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_event_log" (
    "id" SERIAL NOT NULL,
    "media_item_id" TEXT NOT NULL,
    "event_type" "JobEventType" NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tu" (
    "id" SERIAL NOT NULL,
    "tu_id" TEXT NOT NULL,
    "tu_name" TEXT NOT NULL,
    "telegram_user_id" BIGINT NOT NULL,
    "telegram_chat_id" BIGINT NOT NULL,
    "status" "UserTuStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_tu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_stats" (
    "date" DATE NOT NULL,
    "ingested_count" INTEGER NOT NULL DEFAULT 0,
    "downloaded_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "bytes_downloaded" BIGINT NOT NULL DEFAULT 0,
    "bytes_uploaded" BIGINT NOT NULL DEFAULT 0,
    "avg_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "p95_latency_ms" INTEGER NOT NULL DEFAULT 0,
    "flood_wait_count" INTEGER NOT NULL DEFAULT 0,
    "drive_rate_limit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stats_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "media_item_status_idx" ON "media_item"("status");

-- CreateIndex
CREATE INDEX "media_item_chat_id_date_idx" ON "media_item"("chat_id", "date");

-- CreateIndex
CREATE INDEX "media_item_chat_id_message_id_idx" ON "media_item"("chat_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_item_chat_id_message_id_tg_file_unique_id_key" ON "media_item"("chat_id", "message_id", "tg_file_unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_item_chat_id_message_id_media_index_key" ON "media_item"("chat_id", "message_id", "media_index");

-- CreateIndex
CREATE UNIQUE INDEX "drive_date_folder_cache_chat_id_date_path_key" ON "drive_date_folder_cache"("chat_id", "date_path");

-- CreateIndex
CREATE UNIQUE INDEX "group_user_filter_chat_id_user_id_key" ON "group_user_filter"("chat_id", "user_id");

-- CreateIndex
CREATE INDEX "job_event_log_media_item_id_created_at_idx" ON "job_event_log"("media_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_tu_tu_id_key" ON "user_tu"("tu_id");

-- CreateIndex
CREATE INDEX "user_tu_telegram_user_id_status_idx" ON "user_tu"("telegram_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_tu_telegram_user_id_telegram_chat_id_key" ON "user_tu"("telegram_user_id", "telegram_chat_id");

-- AddForeignKey
ALTER TABLE "media_item" ADD CONSTRAINT "media_item_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "group_state"("chat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_folder_map" ADD CONSTRAINT "drive_folder_map_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "group_state"("chat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_date_folder_cache" ADD CONSTRAINT "drive_date_folder_cache_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "group_state"("chat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_user_filter" ADD CONSTRAINT "group_user_filter_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "group_state"("chat_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_event_log" ADD CONSTRAINT "job_event_log_media_item_id_fkey" FOREIGN KEY ("media_item_id") REFERENCES "media_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
