-- Allow historical CLOSED/EXPIRED sessions while enforcing one ACTIVE session per patient+clinician.
DROP INDEX IF EXISTS "break_glass_sessions_patient_id_clinician_id_status_key";

CREATE UNIQUE INDEX IF NOT EXISTS "break_glass_sessions_patient_id_clinician_id_active_idx"
ON "break_glass_sessions" ("patient_id", "clinician_id")
WHERE "status" = 'ACTIVE';
