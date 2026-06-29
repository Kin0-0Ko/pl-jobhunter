import { useState, useEffect } from 'react';
import type { UserProfile } from '@pl-jobhunter/shared';
import { useProfile } from '../hooks/useProfile.js';

const SENIORITY_OPTIONS = ['junior', 'mid', 'senior', 'lead'] as const;
type SeniorityLevel = typeof SENIORITY_OPTIONS[number];

interface SearchPrefsJson {
  target_seniority?: string[];
  max_experience_years?: number;
}

function parseSearchPrefs(raw: string | null): SearchPrefsJson {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SearchPrefsJson;
  } catch {
    return {};
  }
}

export function ProfileForm() {
  const { profile, loading, error, updateProfile } = useProfile();
  const [skills, setSkills] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [preferredContract, setPreferredContract] = useState<UserProfile['preferred_contract']>('both');
  const [targetSeniority, setTargetSeniority] = useState<SeniorityLevel[]>([]);
  const [maxExperienceYears, setMaxExperienceYears] = useState<string>('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setSkills(profile.skills.join(', '));
      setResumeText(profile.resume_text ?? '');
      setPreferredContract(profile.preferred_contract);
      const prefs = parseSearchPrefs(profile.search_preferences);
      setTargetSeniority(
        (prefs.target_seniority ?? []).filter((s): s is SeniorityLevel =>
          SENIORITY_OPTIONS.includes(s as SeniorityLevel)
        )
      );
      setMaxExperienceYears(
        prefs.max_experience_years != null ? String(prefs.max_experience_years) : ''
      );
    }
  }, [profile]);

  const toggleSeniority = (level: SeniorityLevel) => {
    setTargetSeniority(prev =>
      prev.includes(level) ? prev.filter(s => s !== level) : [...prev, level]
    );
  };

  const handleSave = async () => {
    const parsedSkills = skills.split(',').map((s) => s.trim()).filter(Boolean);
    if (parsedSkills.length === 0) {
      setValidationError('Skills must contain at least one entry.');
      return;
    }
    setValidationError(null);
    setSaveState('saving');

    const prefs: SearchPrefsJson = {};
    if (targetSeniority.length > 0) prefs.target_seniority = targetSeniority;
    const maxExp = maxExperienceYears !== '' ? Number(maxExperienceYears) : undefined;
    if (maxExp != null && !isNaN(maxExp) && maxExp >= 0) prefs.max_experience_years = maxExp;

    try {
      await updateProfile({
        skills: parsedSkills,
        resume_text: resumeText || null,
        preferred_contract: preferredContract,
        search_preferences: Object.keys(prefs).length > 0 ? JSON.stringify(prefs) : null,
      });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
    }
  };

  if (loading) {
    return <div className="p-6 text-gray-500">Loading profile…</div>;
  }

  if (error) {
    return <div className="p-6 text-red-500">Failed to load profile: {error}</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">AI Scoring Profile</h2>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Skills <span className="text-gray-400">(comma-separated)</span>
          </label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            placeholder="TypeScript, React, Node.js"
          />
          {validationError && (
            <p className="mt-1 text-sm text-red-600">{validationError}</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Preferred contract
          </label>
          <div className="flex gap-4">
            {(['b2b', 'uop', 'both'] as const).map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="contract"
                  value={c}
                  checked={preferredContract === c}
                  onChange={() => setPreferredContract(c)}
                />
                {c === 'b2b' ? 'B2B' : c === 'uop' ? 'UoP' : 'Both'}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resume / background
          </label>
          <textarea
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={4}
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="5 years Node.js, worked at fintech startups…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Target seniority <span className="text-gray-400 font-normal">(ETL pre-filter)</span>
          </label>
          <div className="flex gap-3 flex-wrap">
            {SENIORITY_OPTIONS.map((level) => (
              <label key={level} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={targetSeniority.includes(level)}
                  onChange={() => toggleSeniority(level)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="capitalize">{level}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Jobs with Senior/Lead/Principal/Staff/Architect titles are blocked when only junior/mid selected.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max experience required <span className="text-gray-400 font-normal">(years, ETL pre-filter)</span>
          </label>
          <input
            type="number"
            min={0}
            max={20}
            className="w-32 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={maxExperienceYears}
            onChange={(e) => setMaxExperienceYears(e.target.value)}
            placeholder="e.g. 3"
          />
          <p className="mt-1 text-xs text-gray-400">
            Jobs requiring more years of experience are discarded before AI scoring. Leave blank to disable.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saveState === 'saving' ? 'Saving…' : 'Save profile'}
          </button>
          {saveState === 'saved' && (
            <span className="text-sm text-green-600">Saved!</span>
          )}
          {saveState === 'error' && (
            <span className="text-sm text-red-600">Save failed.</span>
          )}
        </div>

        {profile?.updated_at && (
          <p className="text-xs text-gray-400">
            Last updated: {new Date(profile.updated_at).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
