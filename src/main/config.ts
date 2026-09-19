import { z } from 'zod';

const envSchema = z.object({
  MAIN_VITE_MS_CLIENT_ID: z.string().min(1).default('00000000-0000-0000-0000-000000000000'),
  MAIN_VITE_MS_AUTHORITY: z.string().url().default('https://login.microsoftonline.com/common'),
  MAIN_VITE_MS_REDIRECT_URI: z.string().url().default('http://localhost:53682'),
  MAIN_VITE_GRAPH_BASE_URL: z.string().url().default('https://graph.microsoft.com/v1.0'),
  MAIN_VITE_SYNC_CONCURRENCY: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 4))
    .pipe(z.number().int().min(1).max(16)),
  MAIN_VITE_MAX_RETRIES: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 5))
    .pipe(z.number().int().min(1).max(10)),
  MAIN_VITE_RETRY_BASE_DELAY_MS: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1000))
    .pipe(z.number().int().min(100)),
  MAIN_VITE_MASS_MOVE_THRESHOLD: z
    .string()
    .optional()
    .transform((v) => (v ? parseFloat(v) : 0.3))
    .pipe(z.number().min(0.01).max(1.0)),
  MAIN_VITE_USE_MOCK_DRIVE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MAIN_VITE_ALLOW_INTERNAL_DESTINATION: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MAIN_VITE_CUSTOM_ICON_PATH: z.string().optional(),
  MAIN_VITE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

function parseAndValidateConfig() {
  const isProd = import.meta.env ? import.meta.env.PROD : process.env.NODE_ENV === 'production';
  const rawEnv = import.meta.env ?? process.env;

  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ');
    throw new Error(`[OneSync Config Error] Invalid environment configuration: ${errorMessages}`);
  }

  const data = parsed.data;

  // Strict production guards: dev flags are forbidden in production
  if (isProd) {
    if (data.MAIN_VITE_USE_MOCK_DRIVE) {
      throw new Error(
        '[OneSync Config Error] MAIN_VITE_USE_MOCK_DRIVE must be false in production mode.'
      );
    }
    if (data.MAIN_VITE_ALLOW_INTERNAL_DESTINATION) {
      throw new Error(
        '[OneSync Config Error] MAIN_VITE_ALLOW_INTERNAL_DESTINATION must be false in production mode.'
      );
    }
  }

  return Object.freeze({
    isProd,
    msClientId: data.MAIN_VITE_MS_CLIENT_ID,
    msAuthority: data.MAIN_VITE_MS_AUTHORITY,
    msRedirectUri: data.MAIN_VITE_MS_REDIRECT_URI,
    graphBaseUrl: data.MAIN_VITE_GRAPH_BASE_URL,
    syncConcurrency: data.MAIN_VITE_SYNC_CONCURRENCY,
    maxRetries: data.MAIN_VITE_MAX_RETRIES,
    retryBaseDelayMs: data.MAIN_VITE_RETRY_BASE_DELAY_MS,
    massMoveThreshold: data.MAIN_VITE_MASS_MOVE_THRESHOLD,
    useMockDrive: data.MAIN_VITE_USE_MOCK_DRIVE,
    allowInternalDestination: data.MAIN_VITE_ALLOW_INTERNAL_DESTINATION,
    customIconPath: data.MAIN_VITE_CUSTOM_ICON_PATH,
    logLevel: data.MAIN_VITE_LOG_LEVEL,
    userAgent: 'ISV|sibansal.dev|OneSync/1.0.0'
  });
}

export const config = parseAndValidateConfig();
export type Config = typeof config;
