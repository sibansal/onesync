import { SyncError } from './errors';

export class ThrottleGate {
  private static resumeAt = 0;

  public static setThrottle(seconds: number): void {
    const until = Date.now() + Math.max(1, seconds) * 1000;
    if (until > this.resumeAt) {
      this.resumeAt = until;
    }
  }

  public static isThrottled(): boolean {
    return Date.now() < this.resumeAt;
  }

  public static getRemainingMs(): number {
    return Math.max(0, this.resumeAt - Date.now());
  }

  public static async waitForGate(): Promise<void> {
    const remaining = this.getRemainingMs();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  public static reset(): void {
    this.resumeAt = 0;
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  useJitter?: boolean;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 60000;
  const useJitter = options.useJitter ?? true;

  let attempt = 0;

  while (attempt <= maxRetries) {
    await ThrottleGate.waitForGate();

    try {
      return await fn(attempt);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }

      if (SyncError.isSyncError(err) && (err.code === 'CANCELLED' || !err.retriable)) {
        throw err;
      }

      attempt++;

      if (attempt > maxRetries) {
        throw err;
      }

      if (options.shouldRetry && !options.shouldRetry(err, attempt)) {
        throw err;
      }

      if (SyncError.isSyncError(err)) {
        if (!err.retriable) {
          throw err;
        }

        if (err.code === 'THROTTLED' && err.retryAfterMs) {
          ThrottleGate.setThrottle(Math.ceil(err.retryAfterMs / 1000));
          await ThrottleGate.waitForGate();
          continue;
        }
      }

      // Calculate exponential backoff with optional jitter
      const expDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = useJitter ? Math.random() * (baseDelayMs * 0.5) : 0;
      const delay = Math.round(expDelay + jitter);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Max retries exceeded');
}
