import type { FastifyInstance } from 'fastify';
import * as etlState from '../scheduler/etl-state.js';
import { runEtl } from '../scheduler/etl.js';
import { sendRunDigest } from '../bot/telegram.js';

export async function etlRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/etl/trigger',
    {
      schema: {
        tags: ['etl'],
        response: {
          202: {
            type: 'object',
            properties: { status: { type: 'string' } },
          },
          409: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (_request, reply) => {
      if (etlState.isRunning) {
        return reply.code(409).send({ error: 'ETL already running' });
      }

      runEtl()
        .then(async () => {
          if (etlState.lastRunSummary) {
            await sendRunDigest(etlState.lastRunSummary).catch((err) =>
              fastify.log.error({ err }, 'etl: failed to send run digest'),
            );
          }
        })
        .catch((err) => fastify.log.error({ err }, 'etl: run failed'));

      return reply.code(202).send({ status: 'started' });
    },
  );
}
