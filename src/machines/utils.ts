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
