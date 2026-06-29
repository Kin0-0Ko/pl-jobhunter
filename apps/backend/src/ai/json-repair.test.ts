import { describe, it, expect } from 'vitest';
import { repairAndParse } from './json-repair.js';

const VALID = { match_score: 80, summary: 'The company seeks a developer', tech_stack: ['TypeScript'] };

describe('repairAndParse()', () => {
  it('parses a clean JSON object', () => {
    const result = repairAndParse(JSON.stringify(VALID));
    expect(result).toEqual({ ok: true, value: VALID });
  });

  it('strips ```json ... ``` fences', () => {
    const result = repairAndParse(`\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\``);
    expect(result.ok).toBe(true);
  });

  it('strips bare ``` fences', () => {
    const result = repairAndParse(`\`\`\`\n${JSON.stringify(VALID)}\n\`\`\``);
    expect(result.ok).toBe(true);
  });

  it('strips <think>...</think> preamble', () => {
    const result = repairAndParse(`<think>I should think about this</think>\n${JSON.stringify(VALID)}`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.match_score).toBe(80);
  });

  it('extracts object from trailing prose', () => {
    const result = repairAndParse(`${JSON.stringify(VALID)}\nHere is my analysis of the job posting.`);
    expect(result.ok).toBe(true);
  });

  it('repairs unterminated string', () => {
    const truncated = '{"match_score":80,"summary":"Looking for a develo';
    const result = repairAndParse(truncated);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.match_score).toBe(80);
  });

  it('repairs missing closing brackets', () => {
    const truncated = '{"match_score":80,"summary":"ok","tech_stack":["ts"';
    const result = repairAndParse(truncated);
    expect(result.ok).toBe(true);
  });

  it('repairs missing closing brace', () => {
    const truncated = '{"match_score":80,"summary":"ok","tech_stack":["ts"]';
    const result = repairAndParse(truncated);
    expect(result.ok).toBe(true);
  });

  it('repairs trailing comma before }', () => {
    const withComma = '{"match_score":80,"summary":"ok","tech_stack":[],}';
    const result = repairAndParse(withComma);
    expect(result.ok).toBe(true);
  });

  it('returns no-json when no { present', () => {
    const result = repairAndParse('I am a developer looking for a role');
    expect(result).toEqual({ ok: false, reason: 'no-json' });
  });

  it('returns no-json on empty string', () => {
    const result = repairAndParse('');
    expect(result).toEqual({ ok: false, reason: 'no-json' });
  });

  it('returns unrepairable on total garbage', () => {
    const result = repairAndParse('{{{{{{{ broken @@@ }}}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['unrepairable', 'invalid-shape', 'no-json']).toContain(result.reason);
  });

  it('returns invalid-shape when valid JSON but wrong shape', () => {
    const result = repairAndParse('{"foo":"bar"}');
    expect(result).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('never throws on any input', () => {
    const inputs = [null as unknown as string, undefined as unknown as string, 123 as unknown as string, ''];
    for (const input of inputs) {
      expect(() => repairAndParse(input)).not.toThrow();
    }
  });
});
