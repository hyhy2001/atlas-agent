/**
 * sequential(fn) wraps an async function so concurrent calls are queued
 * and executed one at a time. Each caller gets their own resolve/reject.
 * Useful for file writes (sessions, task store) where concurrent access
 * would corrupt the file.
 */
export function sequential<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();

  return (...args: T): Promise<R> => {
    const result = tail.then(() => fn(...args));
    // Advance the chain regardless of success/failure so the queue drains
    tail = result.catch(() => {});
    return result;
  };
}
