import type { FastifyInstance } from 'fastify';
import type { JobWithAnalysis, JobStatus } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import { getPool } from '../config/database.js';

const JOB_STATUSES: JobStatus[] = ['NEW', 'FAVORITE', 'APPLIED', 'ARCHIVED'];

const jobWithAnalysisSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    company: { type: 'string' },
    url: { type: 'string' },
    source: { type: 'string' },
    salary_b2b_min: { type: ['number', 'null'] },
    salary_b2b_max: { type: ['number', 'null'] },
    salary_uop_min: { type: ['number', 'null'] },
    salary_uop_max: { type: ['number', 'null'] },
    currency: { type: 'string' },
    status: { type: 'string' },
    created_at: { type: 'string' },
    match_score: { type: ['number', 'null'] },
    summary: { type: ['string', 'null'] },
    tech_stack: { type: ['array', 'null'], items: { type: 'string' } },
    why_good: { type: ['string', 'null'] },
  },
};

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: JobWithAnalysis[] }>(
    '/api/jobs',
    {
      schema: {
        response: { 200: { type: 'array', items: jobWithAnalysisSchema } },
      },
    },
    async (_request, reply) => {
      const pool = await getPool();
      const conn = await pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT
             j.id, j.title, j.company, j.url, j.source,
             j.salary_b2b_min, j.salary_b2b_max,
             j.salary_uop_min, j.salary_uop_max,
             j.currency, j.status, j.created_at,
             a.match_score, a.summary, a.tech_stack, a.why_good
           FROM jobs j
           LEFT JOIN ai_analysis a ON j.id = a.job_id
           ORDER BY a.match_score DESC NULLS LAST`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

        const rows = (result.rows ?? []).map((row) => ({
          id: row['ID'] as string,
          title: row['TITLE'] as string,
          company: row['COMPANY'] as string,
          url: row['URL'] as string,
          source: row['SOURCE'] as 'justjoin' | 'nofluff',
          salary_b2b_min: row['SALARY_B2B_MIN'] as number | null,
          salary_b2b_max: row['SALARY_B2B_MAX'] as number | null,
          salary_uop_min: row['SALARY_UOP_MIN'] as number | null,
          salary_uop_max: row['SALARY_UOP_MAX'] as number | null,
          currency: row['CURRENCY'] as string,
          status: row['STATUS'] as JobStatus,
          created_at: (row['CREATED_AT'] as Date).toISOString(),
          match_score: row['MATCH_SCORE'] as number | null,
          summary: row['SUMMARY'] as string | null,
          tech_stack: row['TECH_STACK'] != null
            ? JSON.parse(row['TECH_STACK'] as string) as string[]
            : null,
          why_good: row['WHY_GOOD'] as string | null,
        }));

        return reply.send(rows);
      } finally {
        await conn.close();
      }
    },
  );

  fastify.patch<{
    Params: { id: string };
    Body: { status: string };
    Reply: { id: string; status: JobStatus } | { error: string };
  }>(
    '/api/jobs/:id',
    {
      schema: {
        params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        body: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] },
        response: {
          200: {
            type: 'object',
            properties: { id: { type: 'string' }, status: { type: 'string' } },
          },
          400: { type: 'object', properties: { error: { type: 'string' } } },
          404: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;

      if (!JOB_STATUSES.includes(status as JobStatus)) {
        return reply.code(400).send({
          error: `Invalid status value. Must be one of: ${JOB_STATUSES.join(', ')}`,
        });
      }

      const pool = await getPool();
      const conn = await pool.getConnection();
      try {
        const result = await conn.execute(
          `UPDATE jobs SET status = :status WHERE id = :id`,
          { status, id },
          { autoCommit: true },
        );

        if (result.rowsAffected === 0) {
          return reply.code(404).send({ error: 'Job not found' });
        }

        return reply.send({ id, status: status as JobStatus });
      } finally {
        await conn.close();
      }
    },
  );
}
