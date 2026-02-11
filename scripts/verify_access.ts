
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';

const GATEWAY_URL = 'http://localhost:3000';
const CLIENT_ID = 'zk-guardian-mobile';
const REDIRECT_URI = 'zkguardian://auth';

// PKCE Helpers
function base64Url(buffer: Buffer) {
    return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function sha256(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest();
}

async function main() {
    console.log('🔍 Verifying Data Access for Dr. Joden -> Riley...\n');

    // 0. Setup PKCE
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(sha256(Buffer.from(codeVerifier)));

    // 1. Authorize (Login)
    console.log('1️⃣  Logging in as Dr. Joden...');

    try {
        const authParams = new URLSearchParams();
        authParams.append('client_id', CLIENT_ID);
        authParams.append('redirect_uri', REDIRECT_URI);
        authParams.append('response_type', 'code');
        authParams.append('state', uuidv4());
        authParams.append('scope', 'launch/patient patient/*.read user/*.read');
        authParams.append('code_challenge', codeChallenge);
        authParams.append('code_challenge_method', 'S256');

        // These are the form fields submitted by the UI
        authParams.append('role', 'clinician');
        authParams.append('clinician_id', 'practitioner-joden');

        // We post to authorize-submit which handles the form
        const authRes = await axios.post(`${GATEWAY_URL}/oauth/authorize-submit`, authParams, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400
        });

        // We expect a 302 redirect
        const location = authRes.headers['location'];
        if (!location) throw new Error('No redirect location found (Login Failed)');

        const url = new URL(location);
        const code = url.searchParams.get('code');
        if (!code) throw new Error('No auth code in redirect');

        console.log('   ✅ Got Auth Code:', code);

        // 2. Exchange Code for Token
        console.log('\n2️⃣  Exchanging Code for Token...');
        const tokenParams = new URLSearchParams();
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('code', code);
        tokenParams.append('redirect_uri', REDIRECT_URI);
        tokenParams.append('client_id', CLIENT_ID);
        tokenParams.append('code_verifier', codeVerifier);

        const tokenRes = await axios.post(`${GATEWAY_URL}/oauth/token`, tokenParams);
        const accessToken = tokenRes.data.access_token;

        if (!accessToken) throw new Error('No access token returned');
        console.log('   ✅ Got Access Token');

        // 3. Fetch Data as Dr. Joden
        console.log('\n3️⃣  Fetching Riley\'s Audit History...');

        const historyRes = await axios.get(`${GATEWAY_URL}/api/patient/patient-riley/access-history`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        console.log('   ✅ Success! Data Retrieved:');
        console.log('   Total Records:', historyRes.data.pagination.total);
        console.log('   Example Record:', historyRes.data.records[0] || 'No records yet');

        // 4. Verify FHIR Proxy Access (Clinical Data)
        console.log('\n4️⃣  Verifying FHIR Proxy (Clinical Data)...');
        try {
            // We expect this to potentially 404 on the public server if 'patient-riley' doesn't exist
            // BUT, getting a 404 means the Gateway *allowed* the request to pass through!
            // If we didn't have consent, we'd get 403 Forbidden from the Gateway.
            await axios.get(`${GATEWAY_URL}/fhir/Patient/patient-riley`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            console.log('   ✅ Success! FHIR Proxy allowed the request (200 OK).');
        } catch (fhirErr: any) {
            if (fhirErr.response?.status === 404) {
                console.log('   ✅ Success! FHIR Proxy allowed the request (Upstream 404 is expected).');
                console.log('       (The Gateway did NOT block us, which means Consent Check passed!)');
            } else if (fhirErr.response?.status === 403) {
                console.error('❌ FHIR Proxy 403 Body:', JSON.stringify(fhirErr.response.data, null, 2));
                throw new Error('❌ FHIR Proxy Forbidden! Consent check failed.');
            } else {
                console.warn('   ⚠️  Unexpected FHIR Status:', fhirErr.response?.status);
            }
        }

    } catch (e: any) {
        console.error('❌ Verification Failed:', e.message);
        if (axios.isAxiosError(e) && e.response) {
            console.error('   Status:', e.response.status);
            // console.error('   Data:', JSON.stringify(e.response.data, null, 2)); // Already printed specific error above
        }
    }
}

main();
