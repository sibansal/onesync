import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPowerSaveBlocker = {
  start: vi.fn(),
  stop: vi.fn(),
  isStarted: vi.fn(),
};

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: (...args: unknown[]) => mockPowerSaveBlocker.start(...args),
    stop: (...args: unknown[]) => mockPowerSaveBlocker.stop(...args),
    isStarted: (...args: unknown[]) => mockPowerSaveBlocker.isStarted(...args),
  },
  app: {
    getPath: () => '/tmp',
  },
}));

import { settingsStore } from '../src/main/settingsStore';
import * as sleepBlocker from '../src/main/sleepBlocker';

describe('Prevent System Sleep & Settings Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsStore.setPreventSleep(false);
    sleepBlocker.cleanupSleepBlocker();
  });

  afterEach(() => {
    sleepBlocker.cleanupSleepBlocker();
  });

  it('settingsStore persists and retrieves preventSleep setting', () => {
    expect(settingsStore.getPreventSleep()).toBe(false);

    settingsStore.setPreventSleep(true);
    expect(settingsStore.getPreventSleep()).toBe(true);

    settingsStore.setPreventSleep(false);
    expect(settingsStore.getPreventSleep()).toBe(false);
  });

  it('setPreventSleep activates powerSaveBlocker with prevent-app-suspension', () => {
    let activeId: number | null = null;
    mockPowerSaveBlocker.start.mockImplementation((type: string) => {
      expect(type).toBe('prevent-app-suspension');
      activeId = 42;
      return 42;
    });
    mockPowerSaveBlocker.isStarted.mockImplementation((id: number) => {
      return activeId === id;
    });
    mockPowerSaveBlocker.stop.mockImplementation((id: number) => {
      if (activeId === id) activeId = null;
    });

    const activated = sleepBlocker.setPreventSleep(true);
    expect(activated).toBe(true);
    expect(mockPowerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(mockPowerSaveBlocker.isStarted).toHaveBeenCalledWith(42);
    expect(sleepBlocker.isPreventSleepActive()).toBe(true);
    expect(settingsStore.getPreventSleep()).toBe(true);

    const deactivated = sleepBlocker.setPreventSleep(false);
    expect(deactivated).toBe(false);
    expect(mockPowerSaveBlocker.stop).toHaveBeenCalledWith(42);
    expect(sleepBlocker.isPreventSleepActive()).toBe(false);
    expect(settingsStore.getPreventSleep()).toBe(false);
  });

  it('initSleepBlocker restores sleep prevention when preference is saved as true', () => {
    let activeId: number | null = null;
    mockPowerSaveBlocker.start.mockImplementation(() => {
      activeId = 99;
      return 99;
    });
    mockPowerSaveBlocker.isStarted.mockImplementation((id: number) => activeId === id);

    settingsStore.setPreventSleep(true);
    sleepBlocker.initSleepBlocker();

    expect(sleepBlocker.isPreventSleepActive()).toBe(true);
  });

  it('cleanupSleepBlocker stops any active blocker on quit', () => {
    let activeId: number | null = null;
    mockPowerSaveBlocker.start.mockImplementation(() => {
      activeId = 101;
      return 101;
    });
    mockPowerSaveBlocker.isStarted.mockImplementation((id: number) => activeId === id);
    mockPowerSaveBlocker.stop.mockImplementation(() => {
      activeId = null;
    });

    sleepBlocker.setPreventSleep(true);
    expect(sleepBlocker.isPreventSleepActive()).toBe(true);

    sleepBlocker.cleanupSleepBlocker();
    expect(mockPowerSaveBlocker.stop).toHaveBeenCalled();
    expect(sleepBlocker.isPreventSleepActive()).toBe(false);
  });
});
