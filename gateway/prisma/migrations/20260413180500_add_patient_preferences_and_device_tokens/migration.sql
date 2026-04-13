-- Restore schema objects that exist in schema.prisma but were never committed
-- to migration history. Clean databases need both tables before the gateway can
-- serve patient preference and push-notification flows.

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_preferences" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "allow_emergency_access" BOOLEAN NOT NULL DEFAULT true,
    "restrict_access_hours" BOOLEAN NOT NULL DEFAULT false,
    "access_hours_start" INTEGER NOT NULL DEFAULT 7,
    "access_hours_end" INTEGER NOT NULL DEFAULT 19,
    "alerts_for_after_hours" BOOLEAN NOT NULL DEFAULT true,
    "alerts_for_new_provider" BOOLEAN NOT NULL DEFAULT true,
    "alerts_for_break_glass" BOOLEAN NOT NULL DEFAULT true,
    "push_notifications" BOOLEAN NOT NULL DEFAULT true,
    "biometric_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_tokens_patient_id_idx" ON "device_tokens"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "patient_preferences_patient_id_key" ON "patient_preferences"("patient_id");

-- CreateIndex
CREATE INDEX "patient_preferences_patient_id_idx" ON "patient_preferences"("patient_id");
