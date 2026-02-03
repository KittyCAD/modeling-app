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
