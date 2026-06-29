export interface RawModelObject {
  match_score: number;
  summary: string;
  tech_stack: string[];
}

export type RepairResult =
  | { ok: true; value: RawModelObject }
  | { ok: false; reason: 'no-json' | 'unrepairable' | 'invalid-shape' };

export type LooseRepairResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'no-json' | 'unrepairable' };

function extractFirstObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function stripWrappers(raw: string): string {
  let s = raw.trim();
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return s;
}

function tryParse(s: string): RawModelObject | null {
  try {
    const v = JSON.parse(s) as unknown;
    if (v === null || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (typeof o.match_score !== 'number') return null;
    if (typeof o.summary !== 'string') return null;
    // tech_stack is optional after truncation — default to [] if missing/invalid
    return {
      match_score: o.match_score,
      summary: o.summary,
      tech_stack: Array.isArray(o.tech_stack) ? (o.tech_stack as string[]) : [],
    };
  } catch {
    return null;
  }
}

function closeDelimiters(s: string): string {
  let fixed = s;
  // strip trailing comma before }
  fixed = fixed.replace(/,(\s*})/g, '$1');
  // close missing ] then }
  const opens = (fixed.match(/\[/g) ?? []).length;
  const closes = (fixed.match(/\]/g) ?? []).length;
  if (opens > closes) fixed = fixed + ']'.repeat(opens - closes);
  const openBraces = (fixed.match(/\{/g) ?? []).length;
  const closeBraces = (fixed.match(/\}/g) ?? []).length;
  if (openBraces > closeBraces) fixed = fixed + '}'.repeat(openBraces - closeBraces);
  return fixed;
}

function repairAttempt(s: string): string {
  // Try 1: just close delimiters
  const closed = closeDelimiters(s);
  try { JSON.parse(closed); return closed; } catch (e1) {
    // Try 2: if unterminated string, close the string then close delimiters
    const msg = e1 instanceof SyntaxError ? e1.message : '';
    if (msg.toLowerCase().includes('unterminated') || msg.toLowerCase().includes('end of json')) {
      const withQuote = closeDelimiters(s + '"');
      try { JSON.parse(withQuote); return withQuote; } catch { /* fall through */ }
      // Try 3: strip trailing partial token then close
      const stripped = s.replace(/"[^"]*$/, '').trimEnd().replace(/,$/, '');
      const strippedClosed = closeDelimiters(stripped);
      try { JSON.parse(strippedClosed); return strippedClosed; } catch { /* fall through */ }
    }
    return closed;
  }
}

export function repairAndParse(raw: string): RepairResult {
  try {
    if (!raw || typeof raw !== 'string') return { ok: false, reason: 'no-json' };

    const stripped = stripWrappers(raw);
    if (!stripped.includes('{')) return { ok: false, reason: 'no-json' };

    // 1. Try direct parse on stripped input
    const direct = tryParse(stripped);
    if (direct) return { ok: true, value: direct };

    // 2. Attempt repair on the full stripped input (handles truncated-no-closing-brace cases)
    const repairedFull = repairAttempt(stripped);
    const fromRepairedFull = tryParse(repairedFull);
    if (fromRepairedFull) return { ok: true, value: fromRepairedFull };

    // 3. Extract first balanced { } block (handles trailing prose)
    const extracted = extractFirstObject(stripped);
    if (!extracted) {
      // No balanced block but { exists — try shape check on repaired full
      try { JSON.parse(repairedFull); return { ok: false, reason: 'invalid-shape' }; } catch { /* fall */ }
      return { ok: false, reason: 'unrepairable' };
    }

    const fromExtract = tryParse(extracted);
    if (fromExtract) return { ok: true, value: fromExtract };

    // 4. Attempt bounded repair on the extracted block
    const repaired = repairAttempt(extracted);
    const fromRepair = tryParse(repaired);
    if (fromRepair) return { ok: true, value: fromRepair };

    // 5. Try shape-only parse (valid JSON but wrong shape)
    try {
      JSON.parse(repaired);
      return { ok: false, reason: 'invalid-shape' };
    } catch {
      return { ok: false, reason: 'unrepairable' };
    }
  } catch {
    return { ok: false, reason: 'unrepairable' };
  }
}

export function repairAndParseLoose(raw: string): LooseRepairResult {
  try {
    if (!raw || typeof raw !== 'string') return { ok: false, reason: 'no-json' };
    const stripped = stripWrappers(raw);
    if (!stripped.includes('{')) return { ok: false, reason: 'no-json' };

    const tryLoose = (s: string): Record<string, unknown> | null => {
      try {
        const v = JSON.parse(s) as unknown;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        return null;
      } catch { return null; }
    };

    const direct = tryLoose(stripped);
    if (direct) return { ok: true, value: direct };

    const repairedFull = repairAttempt(stripped);
    const fromFull = tryLoose(repairedFull);
    if (fromFull) return { ok: true, value: fromFull };

    const extracted = extractFirstObject(stripped);
    if (!extracted) return { ok: false, reason: 'unrepairable' };

    const fromExtract = tryLoose(extracted);
    if (fromExtract) return { ok: true, value: fromExtract };

    const repaired = repairAttempt(extracted);
    const fromRepair = tryLoose(repaired);
    if (fromRepair) return { ok: true, value: fromRepair };

    return { ok: false, reason: 'unrepairable' };
  } catch {
    return { ok: false, reason: 'unrepairable' };
  }
}
