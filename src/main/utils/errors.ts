export type SyncErrorCode =
  | 'NETWORK'
  | 'SERVER_5XX'
  | 'THROTTLED'
  | 'AUTH_EXPIRED'
  | 'DOWNLOAD_URL_EXPIRED'
  | 'HASH_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'REMOTE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'DISK_FULL'
  | 'DRIVE_DISCONNECTED'
  | 'FS_LIMIT'
  | 'PATH_TOO_LONG'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';

export class SyncError extends Error {
  public readonly code: SyncErrorCode;
  public readonly retriable: boolean;
  public readonly retryAfterMs?: number;

  constructor(options: {
    code: SyncErrorCode;
    message: string;
    retriable?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'SyncError';
    this.code = options.code;
    this.retriable = options.retriable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, SyncError.prototype);
  }

  public static isSyncError(err: unknown): err is SyncError {
    return err instanceof SyncError;
  }
}
