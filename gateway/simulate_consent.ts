
console.log('Script started...');
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import path from 'path';

// Force exit after 30 seconds
setTimeout(() => {
    console.error('Timeout reached, exiting...');
    process.exit(1);
}, 30000);

// Load envs
const envPath = path.resolve(process.cwd(), '../.env');
console.log(`Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

// Fallback to local .env
dotenv.config();

console.log('Importing prisma client...');
// Import the app's configured client (supports driver adapters)
import { prisma } from './src/db/client';
import { getRedis, disconnectRedis } from './src/db/redis';

async function main() {
    console.log('🚀 Simulating consent for Riley -> Dr. Joden...');

    const patientId = 'patient-riley';
    const practitionerId = 'dr-demo-456';
    const consentId = 'consent-' + uuidv4();

    console.log('Creating/Updating consent record in DB...');

    // Using deleteMany + create to be safe
    await prisma.consentCache.deleteMany({
        where: {
            patientId,
            practitionerId
        }
    });

    const newConsent = await prisma.consentCache.create({
        data: {
            patientId,
            fhirConsentId: consentId,
            practitionerId,
            allowedCategories: ['http://loinc.org|55217-7'],
            deniedCategories: [],
            validFrom: new Date(),
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            status: 'active',
            syncedAt: new Date()
        }
    });

    console.log(`✅ Consent Created (New ID: ${newConsent.fhirConsentId})`);

    // Seed Redis with Nullifier (Required for ZK Middleware)
    console.log('Seeding Redis with ZK Nullifier...');
    const redis = getRedis();
    const nullifierKey = `zk:nullifier:${patientId}`;
    await redis.set(nullifierKey, '123456789012345678901234567890'); // Mock nullifier
    console.log(`✅ Redis seeded: ${nullifierKey}`);

    console.log(`\nSimulation Complete. Credentials:`);
    console.log(`Patient ID: ${patientId}`);
    console.log(`Doctor ID: ${practitionerId}`);
}

main()
    .catch(e => {
        console.error('❌ Script Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        console.log('Disconnecting...');
        await prisma.$disconnect();
        await disconnectRedis();
        console.log('Done.');
        process.exit(0);
    });
