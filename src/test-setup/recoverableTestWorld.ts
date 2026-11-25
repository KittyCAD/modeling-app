import { afterAll, beforeEach } from 'vitest'

/** Own the complete state needed by a test attempt, including any external session it depends on. */
interface TestWorldLifecycle<T> {
  create: (signal: AbortSignal) => Promise<T>
  reusable: (world: T) => boolean
  dispose: (world: T) => void | Promise<void>
}

/** A suite reuses its healthy world; interruption retires all state before the next attempt. */
export function createRecoverableTestWorld<T>({
  create,
  reusable,
  dispose,
}: TestWorldLifecycle<T>) {
  const shutdown = new AbortController()
  let world: T | undefined
  let pending: Promise<T> | undefined
  let closing: Promise<void> | undefined

  const replace = async (previous: T | undefined) => {
    if (previous !== undefined) await dispose(previous)
    const next = await create(shutdown.signal)
    if (shutdown.signal.aborted || !reusable(next)) {
      await dispose(next)
      return Promise.reject(new Error('The test world closed while opening'))
    }
    world = next
    return next
  }

  return {
    getWorld(): Promise<T> {
      if (shutdown.signal.aborted)
        return Promise.reject(new Error('The test world fixture is disposed'))
      if (pending) return pending
      if (world !== undefined && reusable(world)) return Promise.resolve(world)
      const previous = world
      world = undefined
      pending = replace(previous)
      const clear = () => {
        pending = undefined
      }
      void pending.then(clear, clear)
      return pending
    },
    dispose(): Promise<void> {
      if (closing) return closing
      shutdown.abort()
      const previous = world
      world = undefined
      closing = (async () => {
        if (previous !== undefined) await dispose(previous)
        await pending?.catch(() => undefined)
      })()
      return closing
    },
  }
}

/** Vitest reruns beforeEach on retries; beforeAll would leave retries on the interrupted world. */
export function setupRecoverableTestWorld<T>(
  options: TestWorldLifecycle<T>,
  accept: (world: T) => void | Promise<void>
) {
  const fixture = createRecoverableTestWorld(options)
  beforeEach(async () => accept(await fixture.getWorld()))
  afterAll(() => fixture.dispose())
}
