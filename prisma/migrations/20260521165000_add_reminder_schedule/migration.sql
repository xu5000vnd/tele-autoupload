CREATE TYPE "ReminderScheduleStatus" AS ENUM ('active', 'inactive');

CREATE TYPE "ReminderScheduleTargetRule" AS ENUM (
  'no_media_current_period',
  'all_active_users'
);

CREATE TABLE "reminder_schedule" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ReminderScheduleStatus" NOT NULL DEFAULT 'active',
  "days_of_month" INTEGER[] NOT NULL,
  "send_time" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "target_rule" "ReminderScheduleTargetRule" NOT NULL DEFAULT 'no_media_current_period',
  "message_template" TEXT NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),

  CONSTRAINT "reminder_schedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reminder_schedule_run" (
  "id" SERIAL NOT NULL,
  "schedule_id" INTEGER NOT NULL,
  "run_key" TEXT NOT NULL,
  "run_date" TEXT NOT NULL,
  "trigger_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "campaign_id" TEXT,
  "target_count" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3),

  CONSTRAINT "reminder_schedule_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reminder_schedule_status_idx" ON "reminder_schedule"("status");
CREATE INDEX "reminder_schedule_run_schedule_id_created_at_idx" ON "reminder_schedule_run"("schedule_id", "created_at");
CREATE UNIQUE INDEX "reminder_schedule_run_schedule_id_run_key_key" ON "reminder_schedule_run"("schedule_id", "run_key");

ALTER TABLE "reminder_schedule_run"
  ADD CONSTRAINT "reminder_schedule_run_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "reminder_schedule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
