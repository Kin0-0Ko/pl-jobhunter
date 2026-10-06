import type { FastifyInstance } from 'fastify';
import type { ActivityReport, JobStatus } from '@pl-jobhunter/shared';
import oracledb from 'oracledb';
import { getPool } from '../config/database.js';

const JOB_STATUSES: JobStatus[] = ['NEW', 'FAVORITE', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'ARCHIVED'];

export async function reportsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { download?: string } }>(
    '/api/reports/activity',
    {
      schema: {
        tags: ['reports'],
        querystring: {
          type: 'object',
          properties: { download: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const now = new Date();
      const from = new Date(now);
      from.setMonth(from.getMonth() - 2);

      const pool = await getPool();
      const conn = await pool.getConnection();
      let rows: Record<string, unknown>[];
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT j.source, j.status, j.created_at, j.id, j.title, j.company, a.match_score
           FROM jobs j
           LEFT JOIN ai_analysis a ON j.id = a.job_id
           WHERE j.created_at >= :fromDate`,
          { fromDate: from },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        rows = result.rows ?? [];
      } finally {
        await conn.close();
      }

      const jobs_by_source: Record<string, number> = {};
      const jobs_by_status: Record<JobStatus, number> = {
        NEW: 0, FAVORITE: 0, APPLIED: 0, INTERVIEWING: 0, OFFER: 0, REJECTED: 0, ARCHIVED: 0,
      };
      let scoreSum = 0;
      let scoreCount = 0;
      const topMatches: { id: string; title: string; company: string; match_score: number }[] = [];

      for (const row of rows) {
        const source = row['SOURCE'] as string;
        const status = row['STATUS'] as JobStatus;
        jobs_by_source[source] = (jobs_by_source[source] ?? 0) + 1;
        if (JOB_STATUSES.includes(status)) {
          jobs_by_status[status] += 1;
        }
        const score = row['MATCH_SCORE'] as number | null;
        if (score != null) {
          scoreSum += score;
          scoreCount += 1;
          topMatches.push({
            id: row['ID'] as string,
            title: row['TITLE'] as string,
            company: row['COMPANY'] as string,
            match_score: score,
          });
        }
      }

      topMatches.sort((a, b) => b.match_score - a.match_score);

      const report: ActivityReport = {
        period: { from: from.toISOString(), to: now.toISOString() },
        generated_at: now.toISOString(),
        totals: {
          jobs_scraped: rows.length,
          jobs_by_source,
          jobs_by_status,
          applied: jobs_by_status.APPLIED,
          interviewing: jobs_by_status.INTERVIEWING,
          offers: jobs_by_status.OFFER,
          rejected: jobs_by_status.REJECTED,
        },
        ai: {
          avg_match_score: scoreCount > 0 ? scoreSum / scoreCount : null,
          top_matches: topMatches.slice(0, 10),
        },
      };

      if (request.query.download === '1') {
        const filename = `activity-report-${now.toISOString().slice(0, 10)}.json`;
        void reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      }

      return reply.send(report);
    },
  );
}
