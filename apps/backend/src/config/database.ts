import oracledb from 'oracledb';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createPool(): Promise<oracledb.Pool> {
  const walletDir = path.resolve(__dirname, '../../wallet');

  return oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECTION_STRING,
    walletLocation: walletDir,
    walletPassword: process.env.DB_WALLET_PASSWORD,
    poolMin: 1,
    poolMax: 5,
    poolIncrement: 1,
  });
}

let pool: oracledb.Pool | null = null;

export async function getPool(): Promise<oracledb.Pool> {
  if (pool) {
    return pool;
  }
  pool = await createPool();
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close(0);
    pool = null;
  }
}
