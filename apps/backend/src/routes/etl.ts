import { spawn } from 'child_process';
import type { FastifyInstance } from 'fastify';

export async function etlRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/etl/trigger',
    {
      schema: {
        tags: ['etl'],
        response: {
          202: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              pid: { type: 'number' },
            },
          },
          500: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (_request, reply) => {
      try {
        const child = spawn('node', ['dist/scheduler/etl.js', '--run-once'], {
          detached: true,
          stdio: 'inherit',
        });
        child.unref();
        return reply.code(202).send({ status: 'started', pid: child.pid ?? 0 });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        fastify.log.error({ err: error.message }, 'etl: failed to spawn ETL process');
        return reply.code(500).send({ error: 'Failed to start ETL' });
      }
    },
  );
}
