import { useState, useEffect } from 'react';
import type { SyncState, SyncProgress, SyncLogEntry, DriveStatus } from '../../../shared/types';

export function useSyncState(): {
  syncState: SyncState;
  syncProgress: SyncProgress;
  logs: SyncLogEntry[];
  driveStatus: DriveStatus;
} {
  const [syncState, setSyncState] = useState<SyncState>({
    phase: 'idle',
    isRunning: false,
    isPaused: false,
    isCancelled: false,
    isWaitingMassMove: false,
    pendingMovesCount: 0,
    error: null,
    jobId: null,
  });

  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    phase: 'idle',
    jobId: null,
    filesDone: 0,
    totalFiles: 0,
    bytesDone: 0,
    totalBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    activeDownloads: [],
    downloadedCount: 0,
    upToDateCount: 0,
    restoredCount: 0,
    failedCount: 0,
  });

  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [driveStatus, setDriveStatus] = useState<DriveStatus>({
    connected: true,
    path: null,
  });

  useEffect(() => {
    window.onesync.getSyncState?.().then((st) => {
      if (st) setSyncState(st);
    });

    const unsubState = window.onesync.onSyncState((state) => {
      setSyncState(state);
    });

    const unsubProgress = window.onesync.onSyncProgress((progress) => {
      setSyncProgress(progress);
    });

    const unsubLog = window.onesync.onSyncLog((entry) => {
      setLogs((prev) => {
        const next = [entry, ...prev];
        return next.length > 200 ? next.slice(0, 200) : next;
      });
    });

    const unsubDrive = window.onesync.onDriveStatus((status) => {
      setDriveStatus(status);
    });

    return () => {
      unsubState();
      unsubProgress();
      unsubLog();
      unsubDrive();
    };
  }, []);

  return {
    syncState,
    syncProgress,
    logs,
    driveStatus,
  };
}
