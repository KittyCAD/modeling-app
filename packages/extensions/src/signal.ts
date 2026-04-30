import type { Signal } from './types'

/** Define a new typed extension signal. */
export function defineSignal<Input, Output>(spec: {
  name: string
  defaultValue: Output
  combine: (inputs: readonly Input[]) => Output
}): Signal<Input, Output> {
  return {
    id: Symbol(spec.name),
    name: spec.name,
    defaultValue: spec.defaultValue,
    combine: spec.combine,
  }
}

/** Create a list-like signal where contributions are appended in resolved order. */
export function appendSignal<T>(name: string) {
  return defineSignal<T, readonly T[]>({
    name,
    defaultValue: [],
    combine: (inputs) => inputs,
  })
}

/** Create a signal where the highest-priority contribution wins. */
export function firstWinsSignal<T>(name: string, defaultValue: T) {
  return defineSignal<T, T>({
    name,
    defaultValue,
    combine: (inputs) => (inputs.length > 0 ? inputs[0] : defaultValue),
  })
}

/** Create a shallow object-merge signal for configuration fragments. */
export function mergeObjectsSignal<T extends object>(
  name: string,
  defaultValue: T
) {
  return defineSignal<Partial<T>, T>({
    name,
    defaultValue,
    combine: (inputs) => Object.assign({}, defaultValue, ...inputs),
  })
}
