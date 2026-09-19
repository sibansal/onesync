import type { SyncProgress } from '../../../shared/types';
import { formatBytes, formatSpeed, formatDuration } from '../../../shared/format';

export interface ProgressBarProps {
  progress: SyncProgress;
  isRunning: boolean;
}

export function ProgressBar({ progress, isRunning }: ProgressBarProps): React.JSX.Element {
  const percent =
    progress.totalBytes > 0
      ? Math.min(100, Math.round((progress.bytesDone / progress.totalBytes) * 100))
      : progress.totalFiles > 0
        ? Math.min(100, Math.round((progress.filesDone / progress.totalFiles) * 100))
        : 0;

  const phaseNames: Record<string, string> = {
    idle: 'Idle',
    preflight: 'Preflight Verification',
    scanning: 'Scanning OneDrive Delta',
    planning: 'Comparing Changes',
    downloading: 'Downloading Mirror',
    sweeping: 'Cleaning Up / Restoring',
    finishing: 'Finalizing Run',
    paused: 'Paused',
    error: 'Error',
  };

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '1.25rem',
        marginBottom: '1rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <div>
          {progress.jobId && (
            <span
              style={{
                padding: '0.2rem 0.55rem',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'rgba(56, 139, 253, 0.15)',
                color: 'var(--accent-blue)',
                border: '1px solid rgba(56, 139, 253, 0.3)',
                marginRight: '0.6rem',
              }}
            >
              {progress.jobId}
            </span>
          )}
          <span
            style={{
              padding: '0.2rem 0.6rem',
              borderRadius: '12px',
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              background: isRunning ? 'var(--accent-blue)' : 'var(--bg-surface-elevated)',
              color: '#fff',
              marginRight: '0.75rem',
            }}
          >
            {phaseNames[progress.phase] || progress.phase}
          </span>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {progress.filesDone} of {progress.totalFiles} files
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{percent}%</span>
          {isRunning && progress.speedBytesPerSec > 0 && (
            <span
              style={{
                marginLeft: '0.75rem',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
              }}
            >
              {formatSpeed(progress.speedBytesPerSec)}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          height: '8px',
          background: 'var(--bg-surface-elevated)',
          borderRadius: '4px',
          overflow: 'hidden',
          marginBottom: '0.75rem',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            background: 'linear-gradient(90deg, var(--accent-blue), #58a6ff)',
            borderRadius: '4px',
            transition: 'width 0.2s ease',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <span>
          {formatBytes(progress.bytesDone)} of {formatBytes(progress.totalBytes)}
        </span>
        {isRunning && progress.etaSeconds !== null && (
          <span>ETA: {formatDuration(progress.etaSeconds)}</span>
        )}
      </div>
    </div>
  );
}
