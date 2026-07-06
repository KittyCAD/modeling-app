import type { Service } from './types'

/** Define a named service. Services are singleton by default. */
export function defineService<T>(
  name: string,
  options?: { multiple?: boolean }
): Service<T> {
  return {
    id: Symbol(name),
    name,
    multiple: options?.multiple ?? false,
  }
}
