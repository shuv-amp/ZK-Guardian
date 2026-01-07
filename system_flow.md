# ZK Guardian: System Walkthrough & Architecture Guide

## 1. High-Level Concept
**ZK Guardian** is a privacy-first healthcare data gateway. It solves a critical problem: **How do we prove that a doctor accessed patient data legitimately without revealing *who* the patient is to the public blockchain?**

It achieves this using **Zero-Knowledge Proofs (ZKPs)**. We prove that "This access is compliant with the patient's consent policy" without revealing the patient's ID or the specific medical data.

## 2. The Scenario: "Dr. Alice needs Bob's Blood Test"
Let's trace a single request through the entire system to see how the Mobile App, Gateway, Circuits, and Blockchain interact.

**Actors:**
*   **Clinician**: Dr. Alice (Mobile App)
*   **Patient**: Bob (Mobile App)
*   **Gateway**: The central server (Node.js) protecting the data.
*   **Blockchain**: Polygon Amoy (Smart Contract validation).

---

## 3. Step-by-Step Execution Flow

### Step 1: The Unauthorized Request
Dr. Alice opens her app and searches for Bob (Patient ID: `123`). She clicks "Request Lab Results".
*   **App Action**: HTTP GET `/fhir/Observation?patient=123`.
*   **Gateway Check**: The `smartAuth` middleware sees Dr. Alice has a valid token but **no valid consent session** for Bob's data yet.
*   **Result**: Gateway returns `403 Forbidden` but triggers a **Consent Handshake**.

### Step 2: The Consent Handshake (Real-Time)
Bob's phone is connected via WebSocket to the Gateway.
*   **Gateway Action**: Sends a `CONSENT_REQUEST` socket message to Bob's device: "Dr. Alice wants to see your Lab Results."
*   **Bob's Action**: Bob sees a popup (`ConsentModal.tsx`) and taps **"Approve"**.
*   **Result**: Bob's app sends a signed consent payload back to the Gateway. The Gateway caches this consent in Redis.

### Step 3: The Retry & ZK Proof Generation
Dr. Alice's app (polling in the background) retries the request.
*   **Gateway Action**:
    1.  `zkAuthMiddleware` sees the active consent in Redis.
    2.  It bundles the context: **Dr. Alice's ID**, **Bob's ID**, **Resource (`Observation`)**, and **Current Time**.
    3.  It passes these inputs to the **ZK Circuit** (`AccessIsAllowedSecure.circom`).
*   **The "Magic"**: The circuit checks:
    *   ✅ Is the consent valid for "Observation"? (Yes)
    *   ✅ Is the current time within the consent window? (Yes)
    *   ✅ Is the Clinician ID correct? (Yes)
*   **Output**: The Proving System generates a **Proof** (a small cryptographic blob) and Public Signals (including a *blinded* patient ID).

### Step 4: Blockchain Verification & Audit
Before returning data, the Gateway must log this access on-chain.
*   **Gateway Action**: Calls `ZKGuardianAudit.verifyAndAudit(proof, publicSignals)` on the Smart Contract.
*   **Contract Action** (`ZKGuardianAudit.sol`):
    1.  **Verifies the Proof**: Uses the `Groth16Verifier` to ensure the math is correct.
    2.  **Checks Replay**: Ensures this exact proof hasn't been used before.
    3.  **Logs Event**: Emits `AccessAudited` event with the *blinded* IDs.
*   **Result**: An immutable, tamper-proof record exists saying "A valid access occurred at 10:00 AM", but no one knows it was Bob or Dr. Alice specifically.

### Step 5: Access Granted
*   **Gateway Action**: Once the transaction is confirmed, the Gateway proxies the request to the internal FHIR server.
*   **Result**: Dr. Alice's app receives the JSON data for Bob's blood test. The UI shows "Access Granted" and the green shield icon.

---

## 4. Codebase Deep Dive

### The Circuit (`circuits/AccessIsAllowedSecure.circom`)
This is the "Brain" of the privacy model.
*   **Input**: `patientId`, `patientNullifier` (Secret).
*   **Logic**:
    *   `nullifierHasher`: Creates a unique hash so we can detect if the same consent is reused suspiciously.
    *   `blindedIdHasher`: Mixes `patientId` + `sessionNonce` so the blockchain sees a random-looking number, not "Bob".
    *   `policyHasher`: Binds the consent rules (Doctor + Time + Permission) into a single hash.

### The Contract (`contracts/src/ZKGuardianAudit.sol`)
This is the "Judge".
*   `verifyAndAudit()`: The main entry point.
*   **Replay Protection**: `mapping(bytes32 => bool) public verifiedProofs`. If you try to submit the same proof twice, it reverts.
*   **Nullifier Check**: `mapping(uint256 => bool) public usedNullifiers`. Prevents double-spending a single consent ticket if configured for one-time use.

### The Mobile App (`apps/mobile`)
*   **Patient**: `services/ConsentHandshakeClient.ts` handles the WebSocket logic. `alerts.tsx` shows the history of these on-chain events (fetched via API).
*   **Clinician**: `dashboard.tsx` implements the "Poll-and-Retry" pattern. It handles the `403` -> Wait -> `200` flow seamlessly.

### The Gateway (`gateway/src`)
*   **`middleware/zkAuth.ts`**: The orchestrator. It creates the "Proof Context", calls the ZK Prover, and submits the transaction to Polygon.
*   **`services/zkProofService.ts`**: Wraps `snarkjs` to generate the actual proofs.

## 5. Summary
ZK Guardian uses **Off-Chain Consent** (fast, user-friendly) combined with **On-Chain Auditing** (secure, permanent). The **Zero-Knowledge Circuit** is the bridge that allows us to post audit logs publically without leaking strict HIPAA data.
