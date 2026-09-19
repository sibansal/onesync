import React, { useState } from 'react';
import type { AccountInfo, DriveQuota, DestinationValidation } from '../../../shared/types';
import { formatBytes } from '../../../shared/format';

export interface DestinationScreenProps {
  account: AccountInfo;
  quota: DriveQuota | null;
  onDestinationConfirmed: () => void;
  onSignOut: () => void;
}

export function DestinationScreen({
  account,
  quota,
  onDestinationConfirmed,
  onSignOut
}: DestinationScreenProps): React.JSX.Element {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [validation, setValidation] = useState<DestinationValidation | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handlePickFolder = async (): Promise<void> => {
    try {
      const folder = await window.onesync.pickFolder();
      if (!folder) return;

      setSelectedFolder(folder);
      setIsValidating(true);
      const res = await window.onesync.validateDestination(folder);
      setValidation(res);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        overflowY: 'auto'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: '2rem',
          boxShadow: 'var(--shadow-md)'
        }}
      >
        {/* Account Info Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingBottom: '1rem',
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: '1.5rem'
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{account.name}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {account.email}
            </div>
            {quota && (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Cloud storage: {formatBytes(quota.used)} of {formatBytes(quota.total)} used
              </div>
            )}
          </div>
          <button
            onClick={onSignOut}
            style={{
              padding: '0.35rem 0.75rem',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem'
            }}
          >
            Sign Out
          </button>
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          Choose External Destination
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Select a folder on your external drive. OneSync will create an exact mirror inside{' '}
          <code>onedrive/</code> and preserve moved/modified items in <code>restored/</code>.
        </p>

        {/* Folder Selector Button */}
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            onClick={handlePickFolder}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              background: 'var(--bg-surface-elevated)',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span
              style={{
                fontFamily: selectedFolder ? 'var(--font-mono)' : 'inherit',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {selectedFolder || '📁 Click to select folder on external volume…'}
            </span>
            <span style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginLeft: '1rem' }}>
              Browse…
            </span>
          </button>
        </div>

        {/* Validation Checklist */}
        {isValidating && (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            Inspecting volume and testing writability…
          </div>
        )}

        {validation && !isValidating && (
          <div
            style={{
              background: 'var(--bg-input)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              marginBottom: '1.5rem',
              fontSize: '0.85rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{validation.isExternal ? '✔' : '✖'}</span>
              <span style={{ color: validation.isExternal ? 'inherit' : 'var(--accent-red)' }}>
                Mounted on external volume (/Volumes/)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>{validation.isWritable ? '✔' : '✖'}</span>
              <span style={{ color: validation.isWritable ? 'inherit' : 'var(--accent-red)' }}>
                Writable filesystem (passed write probe)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>✔</span>
              <span>
                Filesystem format: <strong>{validation.fsType}</strong>
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>✔</span>
              <span>Available disk space: {formatBytes(validation.freeSpaceBytes)}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>
                {validation.existingAccount && validation.existingAccount !== account.id ? '✖' : '✔'}
              </span>
              <span
                style={{
                  color:
                    validation.existingAccount && validation.existingAccount !== account.id
                      ? 'var(--accent-red)'
                      : 'inherit'
                }}
              >
                {validation.existingDb
                  ? `Existing state matches active account (${validation.existingAccount})`
                  : 'Fresh OneSync folder ready'}
              </span>
            </div>

            {validation.errors.length > 0 && (
              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.5rem',
                  background: 'rgba(218, 54, 51, 0.1)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--accent-red)'
                }}
              >
                {validation.errors.map((err: string, idx: number) => (
                  <div key={idx}>• {err}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <button
          disabled={!validation?.isValid || isValidating}
          onClick={onDestinationConfirmed}
          style={{
            width: '100%',
            padding: '0.85rem',
            background: validation?.isValid ? 'var(--accent-green)' : 'var(--bg-surface-elevated)',
            color: validation?.isValid ? '#fff' : 'var(--text-muted)',
            borderRadius: 'var(--radius-md)',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: validation?.isValid ? 'pointer' : 'not-allowed'
          }}
        >
          Start Syncing
        </button>
      </div>
    </div>
  );
}
