import React, { useState } from 'react';
import { Banner } from '../components/Banner';

export interface ConnectScreenProps {
  onConnected: () => void;
}

export function ConnectScreen({ onConnected }: ConnectScreenProps): React.JSX.Element {
  const [isWaiting, setIsWaiting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConnect = async (): Promise<void> => {
    setIsWaiting(true);
    setErrorMessage(null);

    try {
      const res = await window.onesync.signIn();
      if (res.success && res.account) {
        onConnected();
      } else {
        setErrorMessage(res.error || 'Authentication could not be completed.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWaiting(false);
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
        textAlign: 'center',
        background: 'radial-gradient(ellipse at top, #161b22 0%, var(--bg-app) 70%)'
      }}
    >
      <div
        style={{
          width: '72px',
          height: '72px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, var(--accent-blue) 0%, #1f6feb 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(47, 129, 247, 0.3)',
          marginBottom: '1.5rem'
        }}
      >
        ☁️
      </div>

      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Connect to OneDrive
      </h1>

      <p
        style={{
          color: 'var(--text-secondary)',
          maxWidth: '440px',
          lineHeight: '1.6',
          marginBottom: '2rem',
          fontSize: '0.95rem'
        }}
      >
        OneSync keeps an atomic, one-way mirror of your cloud files on an external drive. It never
        deletes or modifies anything in your OneDrive.
      </p>

      {errorMessage && (
        <div style={{ maxWidth: '440px', width: '100%', marginBottom: '1.5rem' }}>
          <Banner
            type="error"
            title="Connection Error"
            message={errorMessage}
            actionText="Retry"
            onAction={handleConnect}
          />
        </div>
      )}

      {isWaiting ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              padding: '0.8rem 1.5rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.9rem',
              color: 'var(--text-primary)'
            }}
          >
            Waiting for browser sign-in…
          </div>
          <button
            onClick={() => setIsWaiting(false)}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              textDecoration: 'underline'
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          style={{
            padding: '0.85rem 2rem',
            background: 'var(--accent-blue)',
            color: '#fff',
            borderRadius: 'var(--radius-md)',
            fontSize: '1rem',
            fontWeight: 600,
            boxShadow: '0 4px 14px rgba(47, 129, 247, 0.4)'
          }}
        >
          Connect to OneDrive
        </button>
      )}
    </div>
  );
}
