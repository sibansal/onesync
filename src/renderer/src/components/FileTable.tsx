import React, { useRef, useEffect } from 'react';
import type {
  ActiveDownload,
  FailedItem,
  RestoredItem,
  SyncRunHistory,
  SyncLogEntry,
} from '../../../shared/types';
import { formatBytes } from '../../../shared/format';

export interface ActiveDownloadsProps {
  downloads: ActiveDownload[];
}

export function ActiveDownloadsList({ downloads }: ActiveDownloadsProps): React.JSX.Element {
  if (downloads.length === 0) {
    return <></>;
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '1rem',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          marginBottom: '0.5rem',
        }}
      >
        Active Downloads ({downloads.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {downloads.map((dl) => {
          const pct =
            dl.totalBytes > 0 ? Math.min(100, Math.round((dl.bytesDone / dl.totalBytes) * 100)) : 0;
          return (
            <div key={dl.id} style={{ fontSize: '0.85rem' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    maxWidth: '65%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dl.name}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {formatBytes(dl.bytesDone)} / {formatBytes(dl.totalBytes)} ({pct}%)
                </span>
              </div>
              <div
                style={{
                  height: '4px',
                  background: 'var(--bg-surface-elevated)',
                  borderRadius: '2px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: 'var(--accent-blue)',
                    borderRadius: '2px',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ActivityTab({ logs }: { logs: SyncLogEntry[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const handleScroll = (): void => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 60;
    }
  };

  useEffect(() => {
    if (containerRef.current && isNearBottomRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          color: 'var(--text-muted)',
        }}
      >
        No recent activity logged.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        flex: 1,
        minHeight: '220px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '0.75rem',
        background: 'var(--bg-input)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {logs.map((log, idx) => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const levelColor =
          log.level === 'error'
            ? 'var(--accent-red)'
            : log.level === 'warn'
              ? 'var(--accent-amber)'
              : 'var(--text-secondary)';
        return (
          <div key={idx} style={{ display: 'flex', gap: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>[{time}]</span>
            <span style={{ color: levelColor, fontWeight: 500 }}>[{log.level.toUpperCase()}]</span>
            <span style={{ color: 'var(--text-primary)' }}>{log.message}</span>
          </div>
        );
      })}
    </div>
  );
}

export function FailedTab({
  items,
  onRetry,
}: {
  items: FailedItem[];
  onRetry: () => void;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        ✔ Zero failed files. Everything is running smoothly!
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '0.5rem',
        }}
      >
        <button
          onClick={onRetry}
          style={{
            padding: '0.4rem 0.8rem',
            background: 'var(--accent-blue)',
            color: '#fff',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem',
            fontWeight: 500,
          }}
        >
          Retry Failed
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr
            style={{
              textAlign: 'left',
              borderBottom: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            <th style={{ padding: '6px' }}>File</th>
            <th style={{ padding: '6px' }}>Reason</th>
            <th style={{ padding: '6px' }}>Retries</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '6px', fontFamily: 'var(--font-mono)' }}>{it.name}</td>
              <td style={{ padding: '6px', color: 'var(--accent-red)' }}>
                {it.errorMessage || it.errorCode || 'Unknown error'}
              </td>
              <td style={{ padding: '6px' }}>{it.retryCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RestoredTab({
  items,
  onReveal,
}: {
  items: RestoredItem[];
  onReveal: (path: string) => void;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        No files have been moved to restored/.
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr
          style={{
            textAlign: 'left',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <th style={{ padding: '6px' }}>Original Path</th>
          <th style={{ padding: '6px' }}>Reason</th>
          <th style={{ padding: '6px' }}>Moved At</th>
          <th style={{ padding: '6px' }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px', fontFamily: 'var(--font-mono)' }}>{it.originalPath}</td>
            <td style={{ padding: '6px', color: 'var(--text-secondary)' }}>{it.reason}</td>
            <td style={{ padding: '6px', color: 'var(--text-muted)' }}>
              {new Date(it.movedAt).toLocaleString()}
            </td>
            <td style={{ padding: '6px' }}>
              <button
                onClick={() => onReveal(it.restoredPath)}
                style={{
                  padding: '0.25rem 0.5rem',
                  background: 'var(--bg-surface-elevated)',
                  color: 'var(--accent-blue)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                }}
              >
                Show in Finder
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HistoryTab({ runs }: { runs: SyncRunHistory[] }): React.JSX.Element {
  if (runs.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        No previous sync runs found.
      </div>
    );
  }

  const getStatusColor = (status: SyncRunHistory['status']): string => {
    switch (status) {
      case 'completed':
        return 'var(--accent-green)';
      case 'cancelled':
        return 'var(--accent-amber)';
      case 'failed':
        return 'var(--accent-red)';
      case 'running':
        return 'var(--accent-blue)';
      default:
        return 'var(--text-secondary)';
    }
  };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
      <thead>
        <tr
          style={{
            textAlign: 'left',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <th style={{ padding: '6px' }}>Job</th>
          <th style={{ padding: '6px' }}>Started</th>
          <th style={{ padding: '6px' }}>Status</th>
          <th style={{ padding: '6px' }}>Downloaded</th>
          <th style={{ padding: '6px' }}>Up to date</th>
          <th style={{ padding: '6px' }}>Restored</th>
          <th style={{ padding: '6px' }}>Bytes</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '6px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              Job #{r.id}
            </td>
            <td style={{ padding: '6px' }}>{new Date(r.startedAt).toLocaleString()}</td>
            <td
              style={{
                padding: '6px',
                fontWeight: 600,
                color: getStatusColor(r.status),
              }}
            >
              {r.status.toUpperCase()}
            </td>
            <td style={{ padding: '6px' }}>{r.downloaded}</td>
            <td style={{ padding: '6px' }}>{r.skipped}</td>
            <td style={{ padding: '6px' }}>{r.restored}</td>
            <td style={{ padding: '6px' }}>{formatBytes(r.bytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
