import { powerSaveBlocker } from 'electron';
import { logger } from './logger';
import { settingsStore } from './settingsStore';

let powerSaveBlockerId: number | null = null;

/**
 * Initializes the power save blocker on application startup based on saved settings.
 */
export function initSleepBlocker(): void {
  try {
    const savedPreference = settingsStore.getPreventSleep();
    if (savedPreference) {
      setPreventSleep(true);
    }
  } catch (err) {
    logger.error('Failed to initialize powerSaveBlocker:', err);
  }
}

/**
 * Checks whether the system sleep prevention blocker is actively running.
 */
export function isPreventSleepActive(): boolean {
  try {
    if (
      powerSaveBlockerId !== null &&
      typeof powerSaveBlocker !== 'undefined' &&
      typeof powerSaveBlocker.isStarted === 'function'
    ) {
      return powerSaveBlocker.isStarted(powerSaveBlockerId);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Toggles or sets system sleep prevention.
 * Uses 'prevent-app-suspension' to prevent the OS from sleeping while allowing
 * monitors to sleep if idle.
 */
export function setPreventSleep(enable: boolean): boolean {
  try {
    if (enable) {
      if (
        typeof powerSaveBlocker !== 'undefined' &&
        typeof powerSaveBlocker.start === 'function'
      ) {
        if (
          powerSaveBlockerId === null ||
          !powerSaveBlocker.isStarted(powerSaveBlockerId)
        ) {
          powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
          logger.info(`Started powerSaveBlocker (prevent-app-suspension), id=${powerSaveBlockerId}`);
        }
      }
    } else {
      if (
        typeof powerSaveBlocker !== 'undefined' &&
        typeof powerSaveBlocker.stop === 'function' &&
        powerSaveBlockerId !== null
      ) {
        if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
          powerSaveBlocker.stop(powerSaveBlockerId);
          logger.info(`Stopped powerSaveBlocker, id=${powerSaveBlockerId}`);
        }
      }
      powerSaveBlockerId = null;
    }

    settingsStore.setPreventSleep(enable);
    return isPreventSleepActive();
  } catch (err) {
    logger.error('Error updating powerSaveBlocker:', err);
    return false;
  }
}

/**
 * Releases any active power save blocker before app termination.
 */
export function cleanupSleepBlocker(): void {
  try {
    if (
      typeof powerSaveBlocker !== 'undefined' &&
      typeof powerSaveBlocker.stop === 'function' &&
      powerSaveBlockerId !== null
    ) {
      if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
      }
      powerSaveBlockerId = null;
    }
  } catch {
    // ignore on app shutdown
  }
}
