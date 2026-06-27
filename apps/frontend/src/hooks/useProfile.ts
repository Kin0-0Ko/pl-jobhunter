import { useState, useEffect, useCallback } from 'react';
import type { UserProfile } from '@pl-jobhunter/shared';
import { getProfile, putProfile } from '../api/client.js';

interface UseProfileResult {
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  updateProfile: (data: Omit<UserProfile, 'updated_at'>) => Promise<void>;
}

export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProfile()
      .then((data) => { if (!cancelled) setProfile(data); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const updateProfile = useCallback(async (data: Omit<UserProfile, 'updated_at'>) => {
    const prev = profile;
    setProfile({ ...data, updated_at: new Date().toISOString() });
    try {
      const updated = await putProfile(data);
      setProfile(updated);
    } catch (err: unknown) {
      setProfile(prev);
      throw err;
    }
  }, [profile]);

  return { profile, loading, error, updateProfile };
}
