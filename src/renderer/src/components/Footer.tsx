import React from 'react';

export function Footer(): React.JSX.Element {
  return (
    <footer
      style={{
        padding: '0.75rem 1.5rem',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: '0.8rem',
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'var(--bg-surface)',
      }}
    >
      <span>OneSync — macOS Apple Silicon Mirror</span>
      <span>
        Made by{' '}
        <a
          href="https://sibansal.dev/"
          target="_blank"
          rel="noreferrer"
          style={{
            color: 'var(--accent-blue)',
            textDecoration: 'none',
            fontWeight: 500,
          }}
          onClick={(e) => {
            e.preventDefault();
            window.onesync.openAuthorSite();
          }}
        >
          sibansal.dev
        </a>
      </span>
    </footer>
  );
}
