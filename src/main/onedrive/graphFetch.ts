import { config } from '../config';
import { SyncError } from '../utils/errors';
import { ThrottleGate, withRetry } from '../utils/retry';
import type { AuthService } from '../auth/authService';

export interface GraphFetchOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Robust fetch wrapper for Microsoft Graph API.
 * - Enforces User-Agent app decoration
 * - Attaches Bearer authentication
 * - Handles 401 with silent token refresh
 * - Handles 429/503 by honoring Retry-After via shared ThrottleGate
 * - Retries 5xx and network drops with exponential backoff
 */
export async function graphFetch(
  url: string,
  options: GraphFetchOptions = {},
  authService?: AuthService
): Promise<Response> {
  let hasRefreshedToken = false;

  return withRetry(
    async () => {
      await ThrottleGate.waitForGate();

      const headers = new Headers(options.headers || {});
      headers.set('User-Agent', config.userAgent);

      if (!options.skipAuth && authService) {
        const token = await authService.getAccessToken();
        headers.set('Authorization', `Bearer ${token}`);
      }

      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          headers
        });
      } catch (networkErr: unknown) {
        if (
          options.signal?.aborted ||
          (networkErr instanceof Error && networkErr.name === 'AbortError')
        ) {
          throw new SyncError({
            code: 'CANCELLED',
            message: 'Request was cancelled',
            retriable: false,
            cause: networkErr
          });
        }
        throw new SyncError({
          code: 'NETWORK',
          message: `Network request failed: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
          retriable: true,
          cause: networkErr
        });
      }

      // Handle 401 Unauthorized: refresh token once and retry
      if (response.status === 401 && !options.skipAuth && authService && !hasRefreshedToken) {
        hasRefreshedToken = true;
        throw new SyncError({
          code: 'AUTH_EXPIRED',
          message: 'Access token expired; refreshing token',
          retriable: true
        });
      }

      // Handle 429 Too Many Requests and 503 Service Unavailable
      if (response.status === 429 || response.status === 503) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;
        const validSeconds = isNaN(retryAfterSeconds) ? 5 : Math.max(1, retryAfterSeconds);

        ThrottleGate.setThrottle(validSeconds);

        throw new SyncError({
          code: 'THROTTLED',
          message: `Graph API throttled (${response.status}), retry after ${validSeconds}s`,
          retriable: true,
          retryAfterMs: validSeconds * 1000
        });
      }

      // Handle 5xx Server Errors
      if (response.status >= 500) {
        throw new SyncError({
          code: 'SERVER_5XX',
          message: `Graph API server error: HTTP ${response.status}`,
          retriable: true
        });
      }

      return response;
    },
    {
      maxRetries: config.maxRetries,
      baseDelayMs: config.retryBaseDelayMs,
      useJitter: true
    }
  );
}
