import type { FastifyInstance } from 'fastify';
import type { UserProfile } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import { getPool } from '../config/database.js';

const CONTRACT_TYPES = ['b2b', 'uop', 'both'] as const;

const userProfileSchema = {
  type: ['object', 'null'],
  properties: {
    skills: { type: 'array', items: { type: 'string' } },
    resume_text: { type: ['string', 'null'] },
    preferred_contract: { type: 'string' },
    search_preferences: { type: ['string', 'null'] },
    updated_at: { type: 'string' },
  },
};

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Reply: UserProfile | null }>(
    '/api/profile',
    {
      schema: {
        tags: ['profile'],
        response: { 200: userProfileSchema },
      },
    },
    async (_request, reply) => {
      const pool = await getPool();
      const conn = await pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT skills, resume_text, preferred_contract, search_preferences, updated_at
           FROM user_profile WHERE id = 1`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        const row = result.rows?.[0];
        if (!row) return reply.send(null);

        return reply.send({
          skills: (typeof row['SKILLS'] === 'string' ? JSON.parse(row['SKILLS']) : row['SKILLS']) as string[],
          resume_text: (row['RESUME_TEXT'] as string | null) ?? null,
          preferred_contract: row['PREFERRED_CONTRACT'] as UserProfile['preferred_contract'],
          search_preferences: (row['SEARCH_PREFERENCES'] as string | null) ?? null,
          updated_at: (row['UPDATED_AT'] as Date).toISOString(),
        });
      } finally {
        await conn.close();
      }
    },
  );

  fastify.put<{
    Body: Omit<UserProfile, 'updated_at'>;
    Reply: UserProfile | { error: string };
  }>(
    '/api/profile',
    {
      schema: {
        tags: ['profile'],
        body: {
          type: 'object',
          required: ['skills', 'preferred_contract'],
          properties: {
            skills: { type: 'array', items: { type: 'string' }, minItems: 1 },
            resume_text: { type: ['string', 'null'] },
            preferred_contract: { type: 'string', enum: ['b2b', 'uop', 'both'] },
            search_preferences: { type: ['string', 'null'] },
          },
        },
        response: {
          200: userProfileSchema,
          400: { type: 'object', properties: { error: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      const { skills, resume_text, preferred_contract, search_preferences } = request.body;

      if (skills.filter((s: string) => s.trim()).length === 0) {
        return reply.code(400).send({ error: 'skills must contain at least one non-empty entry' });
      }

      if (!CONTRACT_TYPES.includes(preferred_contract)) {
        return reply.code(400).send({
          error: `preferred_contract must be one of: ${CONTRACT_TYPES.join(', ')}`,
        });
      }

      const pool = await getPool();
      const conn = await pool.getConnection();
      try {
        await conn.execute(
          `MERGE INTO user_profile u
           USING (SELECT 1 AS id FROM dual) src ON (u.id = src.id)
           WHEN MATCHED THEN UPDATE SET
             skills = :skills,
             resume_text = :resume_text,
             preferred_contract = :preferred_contract,
             search_preferences = :search_preferences,
             updated_at = SYSTIMESTAMP
           WHEN NOT MATCHED THEN INSERT
             (id, skills, resume_text, preferred_contract, search_preferences)
           VALUES
             (1, :skills, :resume_text, :preferred_contract, :search_preferences)`,
          {
            skills: JSON.stringify(skills),
            resume_text: resume_text ?? null,
            preferred_contract,
            search_preferences: search_preferences ?? null,
          },
          { autoCommit: true },
        );

        const result = await conn.execute<Record<string, unknown>>(
          `SELECT skills, resume_text, preferred_contract, search_preferences, updated_at
           FROM user_profile WHERE id = 1`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        const row = result.rows?.[0];
        if (!row) return reply.code(500).send({ error: 'profile write succeeded but row not found' });

        return reply.send({
          skills: (typeof row['SKILLS'] === 'string' ? JSON.parse(row['SKILLS']) : row['SKILLS']) as string[],
          resume_text: (row['RESUME_TEXT'] as string | null) ?? null,
          preferred_contract: row['PREFERRED_CONTRACT'] as UserProfile['preferred_contract'],
          search_preferences: (row['SEARCH_PREFERENCES'] as string | null) ?? null,
          updated_at: (row['UPDATED_AT'] as Date).toISOString(),
        });
      } finally {
        await conn.close();
      }
    },
  );
}
