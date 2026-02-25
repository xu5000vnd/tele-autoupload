-- AlterTable
ALTER TABLE "drive_folder_map" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "group_state" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "media_item" ALTER COLUMN "updated_at" DROP NOT NULL;

-- AlterTable
ALTER TABLE "user_tu" ALTER COLUMN "updated_at" DROP NOT NULL;
