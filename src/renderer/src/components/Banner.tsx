import React from 'react';

export interface BannerProps {
  type: 'warning' | 'error' | 'info';
  title?: string;
  message: string;
  actionText?: string;
  onAction?: () => void;
}

export function Banner({
  type,
  title,
  message,
  actionText,
  onAction,
}: BannerProps): React.JSX.Element {
  const bgColors = {
    warning: 'rgba(210, 153, 34, 0.15)',
    error: 'rgba(218, 54, 51, 0.15)',
    info: 'rgba(47, 129, 247, 0.15)',
  };

  const borderColors = {
    warning: 'var(--accent-amber)',
    error: 'var(--accent-red)',
    info: 'var(--accent-blue)',
  };

  return (
    <div
      style={{
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-sm)',
        background: bgColors[type],
        borderLeft: `4px solid ${borderColors[type]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '0.75rem 0',
        fontSize: '0.875rem',
      }}
    >
      <div>
        {title && <strong style={{ marginRight: '0.5rem' }}>{title}</strong>}
        <span>{message}</span>
      </div>
      {actionText && onAction && (
        <button
          onClick={onAction}
          style={{
            padding: '0.3rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            background: borderColors[type],
            color: '#fff',
            fontSize: '0.8rem',
            fontWeight: 500,
          }}
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
