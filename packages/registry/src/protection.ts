import { computed, Signal } from '@preact/signals-core'

/**
 * Expose a service through readonly properties, guarded methods, and readonly
 * signals. Nested ordinary objects remain the service owner's responsibility.
 */
export function protect<T extends object>(
  implementation: T,
  assertMutable: () => void
): T {
  const members = new Map<
    PropertyKey,
    { original: unknown; exposed: unknown }
  >()
  const readonly = (): never => {
    throw new Error('Service surfaces are readonly')
  }
  const read = (key: PropertyKey): unknown => {
    const original: unknown = Reflect.get(implementation, key, implementation)
    const cached = members.get(key)
    if (cached && cached.original === original) return cached.exposed
    const exposed =
      original instanceof Signal
        ? computed(() => original.value)
        : typeof original === 'function'
          ? (...args: unknown[]) => {
              assertMutable()
              return Reflect.apply(original, implementation, args)
            }
          : original
    members.set(key, { original, exposed })
    return exposed
  }

  // A separate extensible target permits wrapped values even when the original
  // properties are frozen. `get` on a frozen target must return its exact value.
  return new Proxy<T>(Object.create(Object.getPrototypeOf(implementation)), {
    get: (_, key) => read(key),
    has: (_, key) => Reflect.has(implementation, key),
    ownKeys: () => Reflect.ownKeys(implementation),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(implementation, key)
      return (
        descriptor && {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: () => read(key),
        }
      )
    },
    set: readonly,
    defineProperty: readonly,
    deleteProperty: readonly,
    setPrototypeOf: readonly,
    preventExtensions: readonly,
  })
}
