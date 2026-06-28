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
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: {
              SKILLS: { type: oracledb.STRING },
              RESUME_TEXT: { type: oracledb.STRING },
              SEARCH_PREFERENCES: { type: oracledb.STRING },
            },
          },
        );
        const row = result.rows?.[0];
        if (!row) return reply.send(null);

        const rawSkills = row['SKILLS'];
        const skills: string[] = Array.isArray(rawSkills)
          ? (rawSkills as string[])
          : typeof rawSkills === 'string'
            ? (JSON.parse(rawSkills) as string[])
            : [];
        const resumeText = row['RESUME_TEXT'];
        const searchPrefs = row['SEARCH_PREFERENCES'];
        return reply.send({
          skills,
          resume_text: resumeText != null ? String(resumeText) : null,
          preferred_contract: row['PREFERRED_CONTRACT'] as UserProfile['preferred_contract'],
          search_preferences: searchPrefs != null ? String(searchPrefs) : null,
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
          {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: {
              SKILLS: { type: oracledb.STRING },
              RESUME_TEXT: { type: oracledb.STRING },
              SEARCH_PREFERENCES: { type: oracledb.STRING },
            },
          },
        );
        const row = result.rows?.[0];
        if (!row) return reply.code(500).send({ error: 'profile write succeeded but row not found' });

        const rawSkills2 = row['SKILLS'];
        const skills2: string[] = Array.isArray(rawSkills2)
          ? (rawSkills2 as string[])
          : typeof rawSkills2 === 'string'
            ? (JSON.parse(rawSkills2) as string[])
            : [];
        const resumeText2 = row['RESUME_TEXT'];
        const searchPrefs2 = row['SEARCH_PREFERENCES'];
        return reply.send({
          skills: skills2,
          resume_text: resumeText2 != null ? String(resumeText2) : null,
          preferred_contract: row['PREFERRED_CONTRACT'] as UserProfile['preferred_contract'],
          search_preferences: searchPrefs2 != null ? String(searchPrefs2) : null,
          updated_at: (row['UPDATED_AT'] as Date).toISOString(),
        });
      } finally {
        await conn.close();
      }
    },
  );
}
