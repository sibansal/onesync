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
  SyncRunHistory
} from '../../../shared/types';
import { ProgressBar } from '../components/ProgressBar';
import {
  ActiveDownloadsList,
  ActivityTab,
  FailedTab,
  RestoredTab,
  HistoryTab
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
  onSignOut
}: DashboardScreenProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'activity' | 'failed' | 'restored' | 'history'>('activity');
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  const [restoredItems, setRestoredItems] = useState<RestoredItem[]>([]);
  const [historyRuns, setHistoryRuns] = useState<SyncRunHistory[]>([]);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

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

  const handleStartSync = async (force = false): Promise<void> => {
    await window.onesync.startSync({ force });
  };

  const handlePauseResume = async (): Promise<void> => {
    if (syncState.isPaused) {
      await window.onesync.resumeSync();
    } else {
      await window.onesync.pauseSync();
    }
  };

  const handleCancel = async (): Promise<void> => {
    await window.onesync.cancelSync();
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
        overflow: 'hidden'
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
          alignItems: 'center'
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
                background: driveStatus.connected ? 'var(--accent-green)' : 'var(--accent-red)'
              }}
            />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{account.name}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              ({account.email})
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              marginTop: '2px'
            }}
          >
            {destinationPath}
          </div>
        </div>

        {/* Action Controls & Settings Menu */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
          {syncState.isRunning ? (
            <>
              <button
                onClick={handlePauseResume}
                style={{
                  padding: '0.45rem 0.9rem',
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: 'var(--text-primary)'
                }}
              >
                {syncState.isPaused ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                onClick={handleCancel}
                style={{
                  padding: '0.45rem 0.9rem',
                  background: 'rgba(218, 54, 51, 0.15)',
                  border: '1px solid var(--accent-red)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  color: 'var(--accent-red)'
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              disabled={!driveStatus.connected}
              onClick={() => handleStartSync(false)}
              style={{
                padding: '0.45rem 1.1rem',
                background: driveStatus.connected ? 'var(--accent-blue)' : 'var(--bg-surface-elevated)',
                color: driveStatus.connected ? '#fff' : 'var(--text-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                fontWeight: 600
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
              fontSize: '0.9rem'
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
                width: '180px',
                background: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                padding: '0.25rem',
                zIndex: 100
              }}
            >
              <button
                onClick={onChangeFolder}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)'
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
                  borderRadius: 'var(--radius-sm)'
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
                  borderRadius: 'var(--radius-sm)'
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
                  borderRadius: 'var(--radius-sm)'
                }}
              >
                About OneSync
              </button>
              <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '0.25rem 0' }} />
              <button
                onClick={onSignOut}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  background: 'transparent',
                  color: 'var(--accent-red)',
                  fontSize: '0.8rem',
                  borderRadius: 'var(--radius-sm)'
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
          minHeight: 0
        }}
      >
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
              marginBottom: '1rem'
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
                  fontSize: '0.85rem'
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
                  fontSize: '0.85rem'
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
        {syncState.isRunning && (
          <ActiveDownloadsList downloads={syncProgress.activeDownloads} />
        )}

        {/* Metrics Counters */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '0.75rem',
            marginBottom: '1.25rem'
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center'
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
              textAlign: 'center'
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
              textAlign: 'center'
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
              textAlign: 'center'
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
            minHeight: '260px'
          }}
        >
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface-elevated)'
            }}
          >
            {(['activity', 'failed', 'restored', 'history'] as const).map((tab) => {
              const labels = {
                activity: `Activity (${logs.length})`,
                failed: `Failed (${syncProgress.failedCount})`,
                restored: 'Restored',
                history: 'History'
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
                    fontSize: '0.85rem'
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
              minHeight: 0
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
    </div>
  );
}
