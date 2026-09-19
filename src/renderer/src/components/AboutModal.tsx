import React from 'react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps): React.JSX.Element | null {
  if (!isOpen) return null;

  return (
    <div
      className="no-drag"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '380px',
          background: 'var(--bg-surface-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
          padding: '2rem 1.75rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '1.2rem',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
          }}
          title="Close"
        >
          ✕
        </button>

        <img
          src="/icon.png"
          alt="OneSync Logo"
          style={{
            width: '72px',
            height: '72px',
            objectFit: 'contain',
            marginBottom: '1rem',
            filter: 'drop-shadow(0 4px 12px rgba(0, 120, 212, 0.25))',
          }}
        />

        <h2
          style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}
        >
          OneSync
        </h2>
        <span
          style={{
            fontSize: '0.8rem',
            color: 'var(--accent-blue)',
            marginTop: '0.25rem',
            fontWeight: 500,
            background: 'rgba(0, 120, 212, 0.1)',
            padding: '2px 8px',
            borderRadius: '999px',
          }}
        >
          Version 1.0.0 (Apple Silicon)
        </span>

        <p
          style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
            margin: '1.25rem 0 1rem 0',
            lineHeight: 1.45,
          }}
        >
          High-performance, reliable one-way mirror from OneDrive to external storage drives.
        </p>

        <div
          style={{
            width: '100%',
            height: '1px',
            background: 'var(--border-subtle)',
            margin: '0.5rem 0 1rem 0',
          }}
        />

        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
          }}
        >
          <div>
            Created by{' '}
            <a
              href="https://sibansal.dev/"
              onClick={(e) => {
                e.preventDefault();
                window.onesync.openAuthorSite();
              }}
              style={{
                color: 'var(--accent-blue)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              sibansal.dev
            </a>
          </div>
          <div>License: MIT &bull; Copyright &copy; {new Date().getFullYear()}</div>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: '1.5rem',
            padding: '0.5rem 1.5rem',
            background: 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
