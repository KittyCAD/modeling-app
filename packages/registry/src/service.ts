import type { Service } from './types'

/** Define a capability with exactly one active provider per registry. */
export function defineService<T>(name: string): Service<T> {
  return {
    id: Symbol(name),
    name,
    kind: 'service',
  }
}
