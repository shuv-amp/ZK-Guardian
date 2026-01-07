-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "clinician_id" TEXT NOT NULL,
    "clinician_name" TEXT,
    "department" TEXT,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "access_event_hash" TEXT NOT NULL,
    "tx_hash" TEXT,
    "block_number" BIGINT,
    "is_break_glass" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_alerts" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "audit_log_id" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "suggested_action" TEXT,
    "related_clinician" TEXT,
    "related_resource_type" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_events" (
    "id" TEXT NOT NULL,
    "audit_log_id" TEXT NOT NULL,
    "clinician_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "justification_hash" TEXT NOT NULL,
    "witness_id" TEXT,
    "review_deadline" TIMESTAMP(3) NOT NULL,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "compliance_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_glass_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_sessions" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "clinician_id" TEXT NOT NULL,
    "clinician_name" TEXT NOT NULL,
    "department" TEXT,
    "reason" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "clinician_signature" TEXT NOT NULL,
    "witness_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "closure_notes" TEXT,
    "accessed_resources" TEXT[],
    "patient_hash" TEXT NOT NULL,
    "clinician_hash" TEXT NOT NULL,
    "reason_hash" TEXT NOT NULL,
    "tx_hash" TEXT,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_glass_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_cache" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "fhir_consent_id" TEXT NOT NULL,
    "practitioner_id" TEXT,
    "allowed_categories" TEXT[],
    "denied_categories" TEXT[],
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_proof_queue" (
    "id" TEXT NOT NULL,
    "proof_a" TEXT NOT NULL,
    "proof_b" TEXT NOT NULL,
    "proof_c" TEXT NOT NULL,
    "public_signals" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "batch_proof_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proof_submissions" (
    "id" TEXT NOT NULL,
    "proof_hash" TEXT NOT NULL,
    "patient_id" TEXT,
    "resource_type" TEXT,
    "clinician_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proof_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_patient_id_idx" ON "audit_logs"("patient_id");

-- CreateIndex
CREATE INDEX "audit_logs_clinician_id_idx" ON "audit_logs"("clinician_id");

-- CreateIndex
CREATE INDEX "audit_logs_access_event_hash_idx" ON "audit_logs"("access_event_hash");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "access_alerts_patient_id_idx" ON "access_alerts"("patient_id");

-- CreateIndex
CREATE INDEX "access_alerts_patient_id_acknowledged_at_idx" ON "access_alerts"("patient_id", "acknowledged_at");

-- CreateIndex
CREATE INDEX "access_alerts_created_at_idx" ON "access_alerts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "break_glass_events_audit_log_id_key" ON "break_glass_events"("audit_log_id");

-- CreateIndex
CREATE INDEX "break_glass_events_patient_id_idx" ON "break_glass_events"("patient_id");

-- CreateIndex
CREATE INDEX "break_glass_events_clinician_id_idx" ON "break_glass_events"("clinician_id");

-- CreateIndex
CREATE INDEX "break_glass_events_review_deadline_idx" ON "break_glass_events"("review_deadline");

-- CreateIndex
CREATE INDEX "break_glass_sessions_patient_id_idx" ON "break_glass_sessions"("patient_id");

-- CreateIndex
CREATE INDEX "break_glass_sessions_clinician_id_idx" ON "break_glass_sessions"("clinician_id");

-- CreateIndex
CREATE INDEX "break_glass_sessions_status_idx" ON "break_glass_sessions"("status");

-- CreateIndex
CREATE INDEX "break_glass_sessions_expires_at_idx" ON "break_glass_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "break_glass_sessions_patient_id_clinician_id_status_key" ON "break_glass_sessions"("patient_id", "clinician_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "consent_cache_fhir_consent_id_key" ON "consent_cache"("fhir_consent_id");

-- CreateIndex
CREATE INDEX "consent_cache_patient_id_idx" ON "consent_cache"("patient_id");

-- CreateIndex
CREATE INDEX "consent_cache_practitioner_id_idx" ON "consent_cache"("practitioner_id");

-- CreateIndex
CREATE INDEX "consent_cache_status_idx" ON "consent_cache"("status");

-- CreateIndex
CREATE INDEX "batch_proof_queue_status_idx" ON "batch_proof_queue"("status");

-- CreateIndex
CREATE INDEX "batch_proof_queue_created_at_idx" ON "batch_proof_queue"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "proof_submissions_proof_hash_key" ON "proof_submissions"("proof_hash");

-- CreateIndex
CREATE INDEX "proof_submissions_proof_hash_idx" ON "proof_submissions"("proof_hash");

-- CreateIndex
CREATE INDEX "proof_submissions_status_idx" ON "proof_submissions"("status");

-- CreateIndex
CREATE INDEX "proof_submissions_expires_at_idx" ON "proof_submissions"("expires_at");

-- AddForeignKey
ALTER TABLE "access_alerts" ADD CONSTRAINT "access_alerts_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_events" ADD CONSTRAINT "break_glass_events_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
