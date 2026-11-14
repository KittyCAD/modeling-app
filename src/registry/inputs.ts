import { computed } from '@preact/signals-core'
import {
  extension,
  type Extension,
  type Facet,
  type Service,
  ServiceResolutionError,
} from 'plankton'

/** Declare a live composition input without reading it during acquisition. */
export function observe<I, O>(facet: Facet<I, O>) {
  return extension({
    create: (_dependencies, owner) => ({ exports: owner.observe(facet) }),
  })
}

/** A provider may change or disappear while its observing consumer remains mounted. */
export function observeService<T extends object>(token: Service<T>) {
  return extension({
    dependencies: { resolution: observe(token) },
    create: ({ resolution }) => {
      const selectedValue = computed(() => {
        const selected = resolution.value
        if (selected.kind === 'conflict')
          // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Match Registry service resolution failures.
          throw new ServiceResolutionError(token.name, selected.providers)
        return selected.kind === 'ready' ? selected.value : undefined
      })
      const current = new Proxy(selectedValue, {
        get(target, property, receiver) {
          // A cached service still checks its observation before construction-time
          // reads. `peek` keeps that check from adding a reactive dependency.
          if (property === 'value') resolution.peek()
          return Reflect.get(target, property, receiver)
        },
      })
      return {
        exports: {
          current,
          required: (): T => {
            const value = current.value
            if (value === undefined)
              // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- Match Registry service resolution failures.
              throw new ServiceResolutionError(token.name, [])
            return value
          },
        },
      }
    },
  })
}

/** Group the declared observations of one application contract. */
export function inputs<const D extends Readonly<Record<string, Extension>>>(
  dependencies: D
) {
  return extension({ dependencies, create: (exports) => ({ exports }) })
}
