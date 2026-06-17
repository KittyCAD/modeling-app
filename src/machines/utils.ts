// Extremely common states to be used by any machine.
export enum S {
  Start = 'start',
  Stop = 'stop',
  Await = 'await',
}

export function transitions<T>(list: T[]): Record<string, { target: T }> {
  return list.reduce(
    (obj, cur) => ({ ...obj, [String(cur)]: { target: cur } }),
    {}
  )
}

export function xstateEventError(event: unknown): unknown {
  if (typeof event !== 'object' || event === null) return undefined

  if ('output' in event) return event.output
  if ('data' in event) return event.data
  if ('error' in event) return event.error

  return undefined
}

export type SubscribableActor<TSnapshot> = {
  getSnapshot: () => TSnapshot
  subscribe: (listener: (snapshot: TSnapshot) => void) => {
    unsubscribe: () => void
  }
}

export function waitForActorSnapshot<TSnapshot>(
  actor: SubscribableActor<TSnapshot>,
  predicate: (snapshot: TSnapshot) => boolean,
  timeoutMs: number
) {
  if (predicate(actor.getSnapshot())) {
    return Promise.resolve(true)
  }

  return new Promise<boolean>((resolve) => {
    let subscription: { unsubscribe: () => void } | undefined
    let settled = false
    const finish = (matched: boolean) => {
      if (settled) {
        return
      }
      settled = true
      globalThis.clearTimeout(timeout)
      subscription?.unsubscribe()
      resolve(matched)
    }
    const timeout = globalThis.setTimeout(() => finish(false), timeoutMs)
    subscription = actor.subscribe((snapshot) => {
      if (predicate(snapshot)) {
        finish(true)
      }
    })
    if (predicate(actor.getSnapshot())) {
      finish(true)
    }
  })
}
