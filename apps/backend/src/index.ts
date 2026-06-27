import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import cron from 'node-cron';
import { authHook } from './middleware/auth.js';
import { closePool } from './config/database.js';
import { jobsRoutes } from './routes/jobs.js';
import { profileRoutes } from './routes/profile.js';
import { runEtl } from './scheduler/etl.js';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
});

await server.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
});

if (process.env.NODE_ENV !== 'production') {
  await server.register(swagger, {
    openapi: {
      info: { title: 'PL-JobHunter API', version: '1.0.0' },
      components: {
        securitySchemes: {
          apiToken: { type: 'apiKey', in: 'header', name: 'x-api-token' },
        },
      },
      security: [{ apiToken: [] }],
    },
  });
  await server.register(swaggerUi, { routePrefix: '/docs' });
}

server.addHook('preHandler', authHook);

server.get('/health', {
  schema: { response: { 200: { type: 'object', properties: { status: { type: 'string' } } } } },
}, async () => ({ status: 'ok' }));

await server.register(jobsRoutes);
await server.register(profileRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

if (process.argv.includes('--run-once')) {
  await runEtl();
  await closePool();
  process.exit(0);
}

try {
  await server.listen({ port, host });
  cron.schedule('0 */6 * * *', () => {
    runEtl().catch((err) => server.log.error('[ETL] cron error:', err));
  });
  server.log.info('[ETL] Cron scheduled: every 6 hours');
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
