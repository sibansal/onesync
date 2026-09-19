import log from 'electron-log/main';
import { app } from 'electron';
import { join } from 'path';
import { config } from './config';

import { homedir } from 'os';

function getHomeDir(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('home');
    }
  } catch {
    // In unit testing environment
  }
  return homedir();
}

// Ensure log file resides in ~/Library/Logs/OneSync/main.log
const logDirectory = join(getHomeDir(), 'Library', 'Logs', 'OneSync');
log.transports.file.resolvePathFn = () => join(logDirectory, 'main.log');
log.transports.file.level = config.logLevel;
log.transports.console.level = config.logLevel;

// Redaction patterns
const BEARER_TOKEN_REGEX = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const ACCESS_TOKEN_REGEX = /(?:access_token|refresh_token|token|code)=([^& \s"']+)/gi;
const DOWNLOAD_URL_REGEX = /https:\/\/[^ \t\r\n"']+(?:sharepoint\.com|1drv\.ms|download\.aspx)[^ \t\r\n"']*/gi;

export function redactSensitive(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(BEARER_TOKEN_REGEX, 'Bearer [REDACTED_TOKEN]')
    .replace(ACCESS_TOKEN_REGEX, (match, _p1) => match.replace(_p1, '[REDACTED]'))
    .replace(DOWNLOAD_URL_REGEX, '[REDACTED_DOWNLOAD_URL]');
}

// Hook into electron-log transforms
log.hooks.push((message) => {
  message.data = message.data.map((item) => {
    if (typeof item === 'string') {
      return redactSensitive(item);
    }
    if (typeof item === 'object' && item !== null) {
      try {
        const json = JSON.stringify(item);
        return JSON.parse(redactSensitive(json));
      } catch {
        return item;
      }
    }
    return item;
  });
  return message;
});

export function getLogFilePath(): string {
  return join(logDirectory, 'main.log');
}

export const logger = {
  debug: (...params: unknown[]) => log.debug(...params),
  info: (...params: unknown[]) => log.info(...params),
  warn: (...params: unknown[]) => log.warn(...params),
  error: (...params: unknown[]) => log.error(...params)
};
