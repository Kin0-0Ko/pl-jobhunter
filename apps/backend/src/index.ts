import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authHook } from './middleware/auth.js';
import { closePool } from './config/database.js';

const server = Fastify({ logger: true });

await server.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
});

server.addHook('preHandler', authHook);

server.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
  // DB pool initialized lazily on first query — wallet not required at startup
} catch (err) {
  server.log.error(err);
  await closePool();
  process.exit(1);
}

const shutdown = async () => {
  await server.close();
  await closePool();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
