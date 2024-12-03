import { debounce } from './utils'

/**
 * A registry for tracking background work and reacting once all work has
 * settled.
 */
export class PromiseRegistry {
  outstanding: Array<TrackedPromise<unknown>>
  settleCallbacks: Array<() => void>

  /**
   * This reduces overhead when there are many promises all settling around the
   * same time by trading some latency for when the overall settling is
   * detected.
   */
  private debouncedCleanUp: () => void

  constructor() {
    this.outstanding = []
    this.settleCallbacks = []
    this.debouncedCleanUp = debounce(this.attemptCleanUp.bind(this), 10)
  }

  track<T>(promise: Promise<T>, onSettle?: () => void) {
    // Since built-in Promises don't have a way to synchronously check if
    // they're settled, it cannot start out settled.
    this.outstanding.push(new TrackedPromise(promise, this.debouncedCleanUp))
    if (onSettle) {
      this.settleCallbacks.push(onSettle)
    }
  }

  /**
   * Returns a promise that resolves when all promises have settled.
   */
  waitForSettle(): Promise<void> {
    return new Promise((resolve) => {
      this.addSettleCallback(resolve)
    })
  }

  /**
   * Add a callback to be called when all promises have settled.
   *
   * @see waitForSettle for a Promise-based interface.
   */
  addSettleCallback(onSettle: () => void) {
    if (this.isSettled()) {
      // Already settled, so schedule the callback.
      setTimeout(onSettle, 0)
    } else {
      this.settleCallbacks.push(onSettle)
    }
  }

  isSettled(): boolean {
    return this.outstanding.every((p) => p.settled)
  }

  private attemptCleanUp() {
    if (this.outstanding.length === 0) {
      return
    }
    // Garbage collect.
    const unsettled = this.outstanding.filter((p) => !p.settled)
    this.outstanding = unsettled
    // Transition to settled.  We could move this into TrackedPromise.
    // It's a trade-off between reducing latency and reducing overhead.
    if (unsettled.length === 0) {
      for (const cb of this.settleCallbacks) {
        cb()
      }
      this.settleCallbacks = []
    }
  }
}

/**
 * Native Promises don't have a way to synchronously detect if they're settled.
 */
class TrackedPromise<T> {
  settled: boolean
  inner: Promise<T>

  constructor(promise: Promise<T>, onSettle: () => void) {
    this.settled = false
    this.inner = promise.finally(() => {
      this.settled = true
      onSettle()
    })
  }
}

/**
 * Singleton regsitry for the whole app.
 */
export const AppPromises = new PromiseRegistry()
