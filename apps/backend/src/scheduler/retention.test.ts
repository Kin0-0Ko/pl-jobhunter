import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();
const commit = vi.fn();
const rollback = vi.fn();
const close = vi.fn();

vi.mock('../config/database.js', () => ({
  getPool: async () => ({
    getConnection: async () => ({ execute, commit, rollback, close }),
  }),
}));

const { runRetention } = await import('./retention.js');

describe('runRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rowsAffected: 0 });
  });

  it('deletes from both tables and commits once', async () => {
    execute
      .mockResolvedValueOnce({ rowsAffected: 3 })
      .mockResolvedValueOnce({ rowsAffected: 7 });

    const res = await runRetention();

    expect(res).toEqual({ jobsDeleted: 3, rawJobsDeleted: 7, cutoffDays: 30 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toContain('DELETE FROM jobs');
    expect(execute.mock.calls[1]?.[0]).toContain('DELETE FROM raw_jobs');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('binds the cutoff as a parameter, never string-interpolated', async () => {
    await runRetention();
    for (const call of execute.mock.calls) {
      expect(call[0]).toContain(":days");
      expect(call[1]).toEqual({ days: 30 });
    }
  });

  it('always uses the hardcoded 30-day cutoff', async () => {
    const res = await runRetention();
    expect(res.cutoffDays).toBe(30);
    expect(execute.mock.calls[0]?.[1]).toEqual({ days: 30 });
  });

  it('rolls back and rethrows when a delete fails', async () => {
    execute
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockRejectedValueOnce(new Error('ORA-00600'));

    await expect(runRetention()).rejects.toThrow('ORA-00600');
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('treats a missing rowsAffected as zero', async () => {
    execute.mockResolvedValue({});
    const res = await runRetention();
    expect(res.jobsDeleted).toBe(0);
    expect(res.rawJobsDeleted).toBe(0);
  });
});
