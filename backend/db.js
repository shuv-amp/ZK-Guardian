// db.js
const { Pool } = require('pg');
require('dotenv').config(); // Load .env

// Create a PostgreSQL pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT), // Important: convert string -> number
  max: 10,            // optional: max connections
  idleTimeoutMillis: 30000, // optional: auto release idle clients
});

// Connection test on server start
(async () => {
  try {
    const client = await pool.connect();
    console.log('🟢 DB connection test successful');
    client.release();
  } catch (err) {
    console.error('🔴 DB connection failed:', err.message);
    process.exit(1); // stop server if DB cannot connect
  }
})();

// Handle unexpected errors
pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;
