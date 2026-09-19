export interface PoolOptions {
  concurrency: number;
  signal?: AbortSignal;
}

export async function mapConcurrent<T, R>(
  items: Iterable<T>,
  fn: (item: T, index: number) => Promise<R>,
  options: PoolOptions,
): Promise<R[]> {
  const { concurrency, signal } = options;
  const results: R[] = [];
  const iterator = items[Symbol.iterator]();
  let index = 0;
  let activeWorkers = 0;
  let hasError: Error | null = null;

  return new Promise((resolve, reject) => {
    function launchNext(): void {
      if (hasError) return;

      if (signal?.aborted) {
        hasError = new Error('Pool aborted');
        reject(hasError);
        return;
      }

      while (activeWorkers < concurrency) {
        const next = iterator.next();
        if (next.done) {
          if (activeWorkers === 0) {
            resolve(results);
          }
          return;
        }

        const currentIndex = index++;
        activeWorkers++;

        fn(next.value, currentIndex)
          .then((res) => {
            results[currentIndex] = res;
            activeWorkers--;
            launchNext();
          })
          .catch((err) => {
            hasError = err instanceof Error ? err : new Error(String(err));
            reject(hasError);
          });
      }
    }

    launchNext();
  });
}

export class TaskQueue {
  private concurrency: number;
  private running = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  public get activeCount(): number {
    return this.running;
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  public add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async (): Promise<void> => {
        this.running++;
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running--;
          this.checkNext();
        }
      };

      this.queue.push(execute);
      this.checkNext();
    });
  }

  private checkNext(): void {
    if (this.running < this.concurrency && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        void nextTask();
      }
    }
  }

  public clear(): void {
    this.queue = [];
  }
}
