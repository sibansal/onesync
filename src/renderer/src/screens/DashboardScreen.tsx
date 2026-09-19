import React, { useState, useEffect, useCallback } from 'react';
import type {
  AccountInfo,
  DriveQuota,
  SyncState,
  SyncProgress,
  SyncLogEntry,
  DriveStatus,
  FailedItem,
  RestoredItem,
  SyncRunHistory,
  RemoteFolder,
} from '../../../shared/types';
import { ProgressBar } from '../components/ProgressBar';
import {
  ActiveDownloadsList,
  ActivityTab,
  FailedTab,
  RestoredTab,
  HistoryTab,
} from '../components/FileTable';
import { Banner } from '../components/Banner';

export interface DashboardScreenProps {
  account: AccountInfo;
  quota: DriveQuota | null;
  destinationPath: string;
  syncState: SyncState;
  syncProgress: SyncProgress;
  logs: SyncLogEntry[];
  driveStatus: DriveStatus;
  onChangeFolder: () => void;
  onSignOut: () => void;
}

export function DashboardScreen({
  account,
  destinationPath,
  syncState,
  syncProgress,
  logs,
  driveStatus,
  onChangeFolder,
  onSignOut,
}: DashboardScreenProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'activity' | 'failed' | 'restored' | 'history'>(
    'activity',
  );
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [restoredItems, setRestoredItems] = useState<RestoredItem[]>([]);
  const [historyRuns, setHistoryRuns] = useState<SyncRunHistory[]>([]);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [sourceFolder, setSourceFolder] = useState<string | null>(null);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [remoteFolders, setRemoteFolders] = useState<RemoteFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [customSourceInput, setCustomSourceInput] = useState('');
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  const loadTabData = useCallback(async () => {
    try {
      if (activeTab === 'failed') {
        const items = await window.onesync.getFailed();
        setFailedItems(items);
      } else if (activeTab === 'restored') {
        const items = await window.onesync.getRestored();
        setRestoredItems(items);
      } else if (activeTab === 'history') {
        const runs = await window.onesync.getHistory();
        setHistoryRuns(runs);
      }
    } catch {
      // ignore
    }
  }, [activeTab]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  useEffect(() => {
    window.onesync.getSourceFolder().then((folder) => {
      setSourceFolder(folder);
      setCustomSourceInput(folder || '');
    });
  }, []);

  const isCancelledState =
    Boolean(syncState.isCancelled) ||
    (!syncState.isRunning && historyRuns[0]?.status === 'cancelled');

  const handleStartSync = async (force = false): Promise<void> => {
    try {
      const res = await window.onesync.startSync({ force });
      if (res && !res.success && res.error) {
        setStatusNotification(`Could not start sync: ${res.error}`);
        setTimeout(() => setStatusNotification(null), 5000);
      }
      await loadTabData();
    } catch (err) {
      setStatusNotification(
        `Error starting sync: ${err instanceof Error ? err.message : String(err)}`,
      );
      setTimeout(() => setStatusNotification(null), 5000);
    }
  };

  const handlePauseResume = async (): Promise<void> => {
    if (syncState.isPaused) {
      await window.onesync.resumeSync();
    } else {
      await window.onesync.pauseSync();
    }
  };

  const handleCancel = async (): Promise<void> => {
    try {
      await window.onesync.cancelSync();
      await loadTabData();
    } catch (err) {
      console.error('Cancel sync failed:', err);
    }
  };

  const handleRetryFailed = async (): Promise<void> => {
    await window.onesync.retryFailed();
    await loadTabData();
  };

  const handleVerifyIntegrity = async (): Promise<void> => {
    setShowSettingsMenu(false);
    await window.onesync.verifyIntegrity();
  };

  const handleOpenLogs = async (): Promise<void> => {
    setShowSettingsMenu(false);
    await window.onesync.openLogs();
  };

  const handleOpenAbout = async (): Promise<void> => {
    setShowSettingsMenu(false);
    await window.onesync.openAbout();
  };

  const handleClearDatabase = async (): Promise<void> => {
    setShowSettingsMenu(false);
    const confirmed = window.confirm(
      'Are you sure you want to clear the local sync database (state.db)?\n\nThis will reset file index tracking and force a clean re-scan on your next sync run. Existing files on disk will NOT be deleted.',
    );
    if (!confirmed) return;

    try {
      const res = await window.onesync.clearDatabase();
      if (res.success) {
        setStatusNotification('Sync database cleared successfully.');
        setTimeout(() => setStatusNotification(null), 4000);
        await loadTabData();
      } else {
        alert(`Failed to clear database: ${res.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to clear database: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleOpenSourceModal = async (): Promise<void> => {
    setShowSettingsMenu(false);
    setShowSourceModal(true);
    setLoadingFolders(true);
    try {
      const folders = await window.onesync.listSourceFolders();
      setRemoteFolders(folders);
    } catch {
      setRemoteFolders([]);
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleApplySourceFolder = async (folderPath: string | null): Promise<void> => {
    await window.onesync.setSourceFolder(folderPath);
    setSourceFolder(folderPath);
    setCustomSourceInput(folderPath || '');
    setShowSourceModal(false);
    setStatusNotification(
      folderPath
        ? `OneDrive source updated to ${folderPath}`
        : 'OneDrive source set to Entire OneDrive (/)',
    );
    setTimeout(() => setStatusNotification(null), 4000);
    await loadTabData();
  };

  const handleReveal = async (relPath: string): Promise<void> => {
    await window.onesync.revealInFinder(relPath, 'restored');
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Top Header Bar */}
      <header
        className="drag-region"
        style={{
          padding: '0.85rem 1.5rem',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: driveStatus.connected ? 'var(--accent-green)' : 'var(--accent-red)',
              }}
            />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{account.name}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              ({account.email})
            </span>
            {(syncState.jobId || syncProgress.jobId) && (
              <span
                style={{
                  padding: '0.15rem 0.5rem',
                  borderRadius: '12px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: 'rgba(56, 139, 253, 0.12)',
                  color: 'var(--accent-blue)',
                  border: '1px solid rgba(56, 139, 253, 0.3)',
                }}
              >
                {syncState.jobId || syncProgress.jobId}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: '2px',
            }}
          >
            Dest: {destinationPath}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '2px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span>
              Source:{' '}
              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {sourceFolder || 'Entire OneDrive (/)'}
              </span>
            </span>
            <button
              onClick={handleOpenSourceModal}
              disabled={syncState.isRunning}
              style={{
                background: 'none',
                border: 'none',
                color: syncState.isRunning ? 'var(--text-muted)' : 'var(--accent-blue)',
                cursor: syncState.isRunning ? 'not-allowed' : 'pointer',
                padding: 0,
                fontSize: '0.75rem',
                textDecoration: 'underline',
              }}
            >
              Change Source
            </button>
          </div>
        </div>

        {/* Action Controls & Settings Menu */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}
        >
          {syncState.isRunning ? (
            <>
              <button
                onClick={handlePauseResume}
                disabled={syncState.isCancelled}
                style={{
                  padding: '0.45rem 0.9rem',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  opacity: syncState.isCancelled ? 0.6 : 1,
                }}
              >
                {syncState.isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                disabled={syncState.isCancelled}
                onClick={handleCancel}
                style={{
                  padding: '0.45rem 0.9rem',
                  background: 'rgba(218, 54, 51, 0.15)',
                  border: '1px solid var(--accent-red)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: 'var(--accent-red)',
                  opacity: syncState.isCancelled ? 0.6 : 1,
                  cursor: syncState.isCancelled ? 'not-allowed' : 'pointer',
                }}
              >
                {syncState.isCancelled ? 'Cancelling...' : 'Cancel'}
              </button>
            </>
          ) : isCancelledState ? (
            <button
              disabled={!driveStatus.connected}
              onClick={() => handleStartSync(false)}
              style={{
                padding: '0.45rem 1.1rem',
                background: driveStatus.connected
                  ? 'var(--accent-amber)'
                  : 'var(--bg-surface-elevated)',
                color: driveStatus.connected ? '#fff' : 'var(--text-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              ↻ Restart Sync
            </button>
          ) : (
            <button
              disabled={!driveStatus.connected}
              onClick={() => handleStartSync(false)}
              style={{
                padding: '0.45rem 1.1rem',
                background: driveStatus.connected
                  ? 'var(--accent-blue)'
                  : 'var(--bg-surface-elevated)',
                color: driveStatus.connected ? '#fff' : 'var(--text-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              Sync Now
            </button>
          )}

          {/* Settings / Overflow menu toggle */}
          <button
            onClick={() => setShowSettingsMenu((prev) => !prev)}
            style={{
              padding: '0.45rem 0.6rem',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
            }}
          >
            ⚙
          </button>

          {showSettingsMenu && (
            <div
              style={{
                position: 'absolute',
                top: '110%',
                right: 0,
                width: '190px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                padding: '0.25rem',
                zIndex: 100,
              }}
            >
              <button
                onClick={handleOpenSourceModal}
                disabled={syncState.isRunning}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                  opacity: syncState.isRunning ? 0.5 : 1,
                }}
              >
                Change OneDrive Source
              </button>
              <button
                onClick={handleClearDatabase}
                disabled={syncState.isRunning}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--accent-amber)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                  opacity: syncState.isRunning ? 0.5 : 1,
                }}
              >
                Clear Sync Database
              </button>
              <div
                style={{ height: '1px', background: 'var(--border-subtle)', margin: '0.25rem 0' }}
              />
              <button
                onClick={onChangeFolder}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Change Destination
              </button>
              <button
                onClick={handleVerifyIntegrity}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Verify Integrity
              </button>
              <button
                onClick={handleOpenLogs}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Open Logs
              </button>
              <button
                onClick={handleOpenAbout}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                About OneSync
              </button>
              <div
                style={{ height: '1px', background: 'var(--border-subtle)', margin: '0.25rem 0' }}
              />
              <button
                onClick={onSignOut}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--accent-red)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          padding: '1.25rem 1.5rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        {/* Status / Toast Notification */}
        {statusNotification && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(56, 139, 253, 0.15)',
              border: '1px solid var(--accent-blue)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              marginBottom: '1rem',
            }}
          >
            ✓ {statusNotification}
          </div>
        )}

        {/* Cancelled Sync Banner */}
        {isCancelledState && !syncState.isRunning && (
          <div
            style={{
              padding: '0.85rem 1.1rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(210, 153, 34, 0.15)',
              border: '1px solid var(--accent-amber)',
              marginBottom: '1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-amber)', fontSize: '0.9rem' }}>
                Sync Cancelled (
                {syncState.jobId || (historyRuns[0] ? `Job #${historyRuns[0].id}` : 'Previous Job')}
                )
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                The previous sync run was cancelled by user. Partially downloaded files were cleanly
                preserved. Click Restart Sync to resume.
              </div>
            </div>
            <button
              disabled={!driveStatus.connected}
              onClick={() => handleStartSync(false)}
              style={{
                padding: '0.4rem 0.9rem',
                background: 'var(--accent-amber)',
                color: '#fff',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                flexShrink: 0,
                marginLeft: '1rem',
              }}
            >
              ↻ Restart Sync
            </button>
          </div>
        )}

        {/* Drive Disconnected Warning Banner */}
        {!driveStatus.connected && (
          <Banner
            type="warning"
            title="Drive Disconnected"
            message="Your external drive is currently not mounted. Sync will resume automatically once the drive is reconnected."
          />
        )}

        {/* Mass-Move Confirmation Banner Modal */}
        {syncState.isWaitingMassMove && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(210, 153, 34, 0.2)',
              border: '2px solid var(--accent-amber)',
              marginBottom: '1rem',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>
              ⚠️ Mass-Move Confirmation Required
            </div>
            <p style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              OneDrive reported widespread changes that would move{' '}
              <strong>{syncState.pendingMovesCount}</strong> files from <code>onedrive/</code> into{' '}
              <code>restored/</code> (exceeding safety threshold). Do you want to approve this
              mass-move?
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => window.onesync.confirmMassMove(true)}
                style={{
                  padding: '0.4rem 1rem',
                  background: 'var(--accent-amber)',
                  color: '#fff',
                  borderRadius: 'var(--radius-sm)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                Approve & Continue
              </button>
              <button
                onClick={() => window.onesync.confirmMassMove(false)}
                style={{
                  padding: '0.4rem 1rem',
                  background: 'var(--bg-surface-elevated)',
                  color: 'var(--text-primary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}
              >
                Cancel Sync
              </button>
            </div>
          </div>
        )}

        {/* Live Progress Bar */}
        <ProgressBar progress={syncProgress} isRunning={syncState.isRunning} />

        {/* Active Concurrent Downloads (≤ 8) */}
        {syncState.isRunning && <ActiveDownloadsList downloads={syncProgress.activeDownloads} />}

        {/* Metrics Counters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
              {syncProgress.downloadedCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Downloaded
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-green)' }}>
              {syncProgress.upToDateCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Up to date
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-amber)' }}>
              {syncProgress.restoredCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Moved to restored
            </div>
          </div>

          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-red)' }}>
              {syncProgress.failedCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Failed
            </div>
          </div>
        </div>

        {/* Tab Selector & Panels */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            minHeight: '260px',
          }}
        >
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-elevated)',
            }}
          >
            {(['activity', 'failed', 'restored', 'history'] as const).map((tab) => {
              const labels = {
                activity: `Activity (${logs.length})`,
                failed: `Failed (${syncProgress.failedCount})`,
                restored: 'Restored',
                history: 'History',
              };
              const isSelected = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    background: isSelected ? 'var(--bg-surface)' : 'transparent',
                    borderRight: '1px solid var(--border-subtle)',
                    borderBottom: isSelected ? '2px solid var(--accent-blue)' : 'none',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 500,
                    fontSize: '0.85rem',
                  }}
                >
                  {labels[tab]}
                </button>
              );
            })}
          </div>

          <div
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {activeTab === 'activity' && <ActivityTab logs={logs} />}
            {activeTab === 'failed' && (
              <FailedTab items={failedItems} onRetry={handleRetryFailed} />
            )}
            {activeTab === 'restored' && (
              <RestoredTab items={restoredItems} onReveal={handleReveal} />
            )}
            {activeTab === 'history' && <HistoryTab runs={historyRuns} />}
          </div>
        </div>
      </div>

      {/* OneDrive Source Folder Selection Modal */}
      {showSourceModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.5rem',
              width: '460px',
              maxWidth: '90vw',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>
              Select OneDrive Source Folder
            </h3>
            <p
              style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}
            >
              Choose whether to mirror your entire OneDrive or scope synchronization to a single
              root directory.
            </p>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
                maxHeight: '220px',
              }}
            >
              <div
                onClick={() => setCustomSourceInput('')}
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  background: !customSourceInput ? 'rgba(56, 139, 253, 0.15)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontWeight: !customSourceInput ? 600 : 400,
                }}
              >
                <span>☁️</span>
                <div>
                  <div>Entire OneDrive (/)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Mirror all files and folders
                  </div>
                </div>
              </div>

              {loadingFolders ? (
                <div
                  style={{
                    padding: '1.5rem',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                  }}
                >
                  Loading OneDrive folders...
                </div>
              ) : remoteFolders.length === 0 ? (
                <div
                  style={{
                    padding: '1rem',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                  }}
                >
                  No root folders found or offline. You can also specify a folder path below.
                </div>
              ) : (
                remoteFolders.map((f) => {
                  const isSelected =
                    customSourceInput === f.path ||
                    customSourceInput === f.name ||
                    customSourceInput === `/${f.name}`;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setCustomSourceInput(f.path)}
                      style={{
                        padding: '0.65rem 1rem',
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(56, 139, 253, 0.15)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      <span>📁</span>
                      <div>
                        <div>{f.name}</div>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {f.path}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  marginBottom: '4px',
                }}
              >
                Folder Path (leave blank for entire OneDrive):
              </label>
              <input
                type="text"
                placeholder="e.g. /Documents or Documents"
                value={customSourceInput}
                onChange={(e) => setCustomSourceInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                onClick={() => setShowSourceModal(false)}
                style={{
                  padding: '0.45rem 1rem',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  handleApplySourceFolder(
                    customSourceInput.trim() ? customSourceInput.trim() : null,
                  )
                }
                style={{
                  padding: '0.45rem 1.1rem',
                  background: 'var(--accent-blue)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                }}
              >
                Apply Source
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
