import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, ThrottleGate } from '../src/main/utils/retry';
import { TaskQueue, mapConcurrent } from '../src/main/utils/pool';
import { SyncError } from '../src/main/utils/errors';

describe('ThrottleGate & withRetry', () => {
  beforeEach(() => {
    ThrottleGate.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('honors ThrottleGate throttle window', async () => {
    ThrottleGate.setThrottle(5);
    expect(ThrottleGate.isThrottled()).toBe(true);
    expect(ThrottleGate.getRemainingMs()).toBeGreaterThan(0);

    vi.advanceTimersByTime(5100);
    expect(ThrottleGate.isThrottled()).toBe(false);
  });

  it('retries retriable SyncError up to maxRetries', async () => {
    let attempts = 0;
    const task = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        throw new SyncError({ code: 'NETWORK', message: 'Connection lost', retriable: true });
      }
      return 'success';
    });

    const promise = withRetry(task, { maxRetries: 3, baseDelayMs: 100, useJitter: false });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    const result = await promise;
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('fails immediately on non-retriable SyncError', async () => {
    const task = vi.fn(async () => {
      throw new SyncError({ code: 'FORBIDDEN', message: 'Item forbidden', retriable: false });
    });

    await expect(withRetry(task, { maxRetries: 3 })).rejects.toThrow('Item forbidden');
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('TaskQueue & mapConcurrent', () => {
  it('enforces concurrency bounds in TaskQueue', async () => {
    const queue = new TaskQueue(2);
    let peakConcurrency = 0;
    let active = 0;

    const runTask = async (): Promise<void> => {
      active++;
      peakConcurrency = Math.max(peakConcurrency, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active--;
    };

    const tasks = [1, 2, 3, 4, 5].map(() => queue.add(runTask));
    await Promise.all(tasks);

    expect(peakConcurrency).toBe(2);
  });

  it('maps items with bounded concurrency in mapConcurrent', async () => {
    const items = [1, 2, 3, 4];
    let running = 0;
    let maxRunning = 0;

    const results = await mapConcurrent(
      items,
      async (item) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        return item * 10;
      },
      { concurrency: 2 },
    );

    expect(results).toEqual([10, 20, 30, 40]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });
});
