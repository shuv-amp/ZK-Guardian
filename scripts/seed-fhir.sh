#!/bin/bash
# ZK Guardian - FHIR Test Data Seeder
# Seeds the HAPI FHIR server with test patients, practitioners, and consents

set -e

FHIR_URL="${1:-http://localhost:8080/fhir}"

echo "🏥 ZK Guardian FHIR Test Data Seeder"
echo "====================================="
echo "FHIR Server: ${FHIR_URL}"
echo ""

# Wait for FHIR server to be ready
echo "⏳ Waiting for FHIR server..."
until curl -s "${FHIR_URL}/metadata" > /dev/null 2>&1; do
    sleep 2
done
echo "✅ FHIR server is ready"
echo ""

# Create test patient
echo "👤 Creating test patient..."
curl -X PUT "${FHIR_URL}/Patient/patient-123" \
    -H "Content-Type: application/fhir+json" \
    -d '{
        "resourceType": "Patient",
        "id": "patient-123",
        "active": true,
        "name": [{"family": "TestPatient", "given": ["Alice"]}],
        "gender": "female",
        "birthDate": "1990-05-15"
    }' -s -o /dev/null

# Create test practitioner
echo "🩺 Creating test practitioner..."
curl -X PUT "${FHIR_URL}/Practitioner/dr-smith" \
    -H "Content-Type: application/fhir+json" \
    -d '{
        "resourceType": "Practitioner",
        "id": "dr-smith",
        "active": true,
        "name": [{"family": "Smith", "given": ["Jane"], "prefix": ["Dr."]}],
        "qualification": [{"code": {"text": "Internal Medicine"}}]
    }' -s -o /dev/null

# Create consent
echo "📋 Creating consent..."
curl -X PUT "${FHIR_URL}/Consent/consent-zk-example" \
    -H "Content-Type: application/fhir+json" \
    -d '{
        "resourceType": "Consent",
        "id": "consent-zk-example",
        "status": "active",
        "scope": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/consentscope", "code": "patient-privacy"}]
        },
        "category": [{"coding": [{"system": "http://loinc.org", "code": "59284-0"}]}],
        "patient": {"reference": "Patient/patient-123"},
        "dateTime": "2026-01-01T00:00:00Z",
        "provision": {
            "type": "permit",
            "period": {"start": "2026-01-01", "end": "2026-12-31"},
            "actor": [{"role": {"coding": [{"code": "PRCP"}]}, "reference": {"reference": "Practitioner/dr-smith"}}],
            "class": [
                {"system": "http://zkguardian.io/fhir/CodeSystem/resource-category", "code": "laboratory"},
                {"system": "http://zkguardian.io/fhir/CodeSystem/resource-category", "code": "vital-signs"}
            ]
        }
    }' -s -o /dev/null

# Create sample observations
echo "🧪 Creating sample observations..."
for i in 1 2 3; do
    curl -X PUT "${FHIR_URL}/Observation/obs-lab-${i}" \
        -H "Content-Type: application/fhir+json" \
        -d "{
            \"resourceType\": \"Observation\",
            \"id\": \"obs-lab-${i}\",
            \"status\": \"final\",
            \"category\": [{\"coding\": [{\"system\": \"http://terminology.hl7.org/CodeSystem/observation-category\", \"code\": \"laboratory\"}]}],
            \"code\": {\"coding\": [{\"system\": \"http://loinc.org\", \"code\": \"2093-3\", \"display\": \"Cholesterol\"}]},
            \"subject\": {\"reference\": \"Patient/patient-123\"},
            \"effectiveDateTime\": \"2026-01-0${i}T10:00:00Z\",
            \"valueQuantity\": {\"value\": $((180 + i * 10)), \"unit\": \"mg/dL\"}
        }" -s -o /dev/null
done

echo ""
echo "✅ Test data seeded successfully!"
echo ""
echo "Test Resources:"
echo "  - Patient:      patient-123 (Alice TestPatient)"
echo "  - Practitioner: dr-smith (Dr. Jane Smith)"
echo "  - Consent:      consent-zk-example (lab + vital-signs)"
echo "  - Observations: obs-lab-1, obs-lab-2, obs-lab-3"
