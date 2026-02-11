
import { getRedis, disconnectRedis } from '../src/db/redis';
import * as dotenv from 'dotenv';
import path from 'path';

const envPath = path.resolve(process.cwd(), '../.env');
dotenv.config({ path: envPath });

async function main() {
    console.log('Checking Redis...');
    const redis = getRedis();
    const key = 'zk:nullifier:patient-riley';
    const value = await redis.get(key);
    console.log(`Key: ${key}`);
    console.log(`Value: ${value}`);
    if (value) {
        console.log('✅ Key exists!');
    } else {
        console.error('❌ Key missing!');
    }
    await disconnectRedis();
}

main().catch(console.error);
