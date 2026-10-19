import type { ValueSpec } from './types'

/** Define a new typed registry value spec. */
export function defineValueSpec<Input, Output>(spec: {
  name: string
  defaultValue: Output
  combine: (inputs: readonly Input[]) => Output
}): ValueSpec<Input, Output> {
  return {
    id: Symbol(spec.name),
    name: spec.name,
    defaultValue: spec.defaultValue,
    combine: spec.combine,
  }
}

/** Create a list-like value spec where contributions are appended in resolved order. */
export function appendValueSpec<T>(name: string) {
  return defineValueSpec<T, readonly T[]>({
    name,
    defaultValue: [],
    combine: (inputs) => inputs,
  })
}

/**
 * Select a composed value by precedence. Do not use contribution order to select
 * a runtime implementation or a test override; use an explicitly chosen service provider.
 */
export function firstWinsValueSpec<T>(name: string, defaultValue: T) {
  return defineValueSpec<T, T>({
    name,
    defaultValue,
    combine: (inputs) => (inputs.length > 0 ? inputs[0] : defaultValue),
  })
}

/** Create a shallow object-merge value spec for configuration fragments. */
export function mergeObjectsValueSpec<T extends object>(
  name: string,
  defaultValue: T
) {
  return defineValueSpec<Partial<T>, T>({
    name,
    defaultValue,
    combine: (inputs) => Object.assign({}, defaultValue, ...inputs),
  })
}
