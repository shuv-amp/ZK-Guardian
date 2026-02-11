#!/bin/bash

# Configuration
API="http://localhost:3000"
TOKEN="dev-bypass"
PATIENT="patient-riley"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "=============================================="
echo "      ZK Guardian End-to-End Test Flow        "
echo "=============================================="

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}[PASS]${NC} $2"
    else
        echo -e "${RED}[FAIL]${NC} $2"
    fi
}

# 1. Health Check
echo -e "\n1. Checking System Health..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/health")
if [ "$HEALTH_STATUS" == "200" ]; then
    print_status 0 "Gateway is healthy (200 OK)"
else
    print_status 1 "Gateway is UNHEALTHY ($HEALTH_STATUS)"
    exit 1
fi

# 2. Verify Synthetic Consent
echo -e "\n2. Verifying Synthetic Consent (Gateway Fix)..."
CONSENT_RESP=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/fhir/Consent?patient=$PATIENT")
if [[ "$CONSENT_RESP" == *"synthetic-$PATIENT"* ]]; then
    print_status 0 "Synthetic Consent retrieved successfully"
else
    print_status 1 "Synthetic Consent NOT found"
    echo "Response: $CONSENT_RESP"
fi

# 3. Test Standard Access (Obsveration) - Should be ALLOWED
echo -e "\n3. Testing Standard Access (Observation) - Expecting ALLOWED..."
# We use -H "Authorization: Bearer $TOKEN" simulating a logged-in clinician
OBS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$API/fhir/Observation?patient=$PATIENT")

if [ "$OBS_STATUS" == "200" ]; then
    print_status 0 "Access to Observation ALLOWED (200 OK)"
else
    print_status 1 "Access to Observation FAILED ($OBS_STATUS)"
fi

# 4. Test Unauthorized Access (Immunization) - Should be DENIED
# Immunization is NOT in the synthetic consent scope
echo -e "\n4. Testing Unauthorized Access (Immunization) - Expecting DENIED..."
IMM_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$API/fhir/Immunization?patient=$PATIENT")

# Note: ZK Auth might return 403 (Forbidden) or 500 (Audit Failed) if proof generation fails due to missing consent
if [ "$IMM_STATUS" == "403" ] || [ "$IMM_STATUS" == "401" ]; then
    print_status 0 "Access to Immunization DENIED ($IMM_STATUS)"
elif [ "$IMM_STATUS" == "500" ]; then
    # In some dev modes, failure to generate proof might look like a 500
    echo -e "${RED}[WARN]${NC} Access DENIED but with 500 Error (Proof Gen Failed?)"
else
    echo -e "${RED}[FAIL]${NC} Access to Immunization was ALLOWED ($IMM_STATUS) - Security Scope Issue?"
fi

# 5. Test Break-Glass Access (Immunization) - Should be ALLOWED
echo -e "\n5. Testing Break-Glass Access (Immunization) - Expecting ALLOWED..."
BG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" -H "X-Break-Glass: true" "$API/fhir/Immunization?patient=$PATIENT")

if [ "$BG_STATUS" == "200" ]; then
    print_status 0 "Break-Glass Access ALLOWED (200 OK)"
else
    print_status 1 "Break-Glass Access FAILED ($BG_STATUS)"
fi

# 6. Verify Audit Log
echo -e "\n6. Verifying Audit Log Entries..."
HISTORY_RESP=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/api/patient/$PATIENT/access-history?includeBreakGlass=true")

# Check for meaningful data
if [[ "$HISTORY_RESP" == *"accessEventHash"* ]]; then
    COUNT=$(echo $HISTORY_RESP | grep -o "accessEventHash" | wc -l)
    print_status 0 "Found $COUNT access records in history"
else
    print_status 1 "No access records found in history path"
    echo "Response: $HISTORY_RESP"
fi

echo -e "\n=============================================="
echo "              Test Complete                   "
echo "=============================================="
