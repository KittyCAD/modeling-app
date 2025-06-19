// Extremely common states to be used by any machine.
export enum S {
  Start = 'start',
  Stop = 'stop',
  Await = 'await',
}

export const transitions = <T>(list: T[]): { target: string }[] => {
  return list.reduce((obj, cur) => ({ ...obj, [cur]: { target: cur } }), {})
}
