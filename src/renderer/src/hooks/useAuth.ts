import { useState, useEffect, useCallback } from 'react';
import type { AccountInfo, DriveQuota } from '../../../shared/types';

export function useAuth(): {
  loading: boolean;
  signedIn: boolean;
  account: AccountInfo | null;
  quota: DriveQuota | null;
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshStatus: () => Promise<void>;
} {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [quota, setQuota] = useState<DriveQuota | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await window.onesync.getStatus();
      setSignedIn(res.signedIn);
      setAccount(res.account);
      setQuota(res.quota);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const signIn = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      const res = await window.onesync.signIn();
      if (res.success && res.account) {
        setSignedIn(true);
        setAccount(res.account);
        await refreshStatus();
        return true;
      } else {
        setError(res.error || 'Sign in failed');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      await window.onesync.signOut();
      setSignedIn(false);
      setAccount(null);
      setQuota(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    signedIn,
    account,
    quota,
    error,
    signIn,
    signOut,
    refreshStatus,
  };
}
