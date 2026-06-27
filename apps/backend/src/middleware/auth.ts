import type { FastifyReply, FastifyRequest } from 'fastify';

export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.headers['x-api-token'];
  if (!token || token !== process.env.API_TOKEN) {
    await reply.code(401).send();
  }
}
