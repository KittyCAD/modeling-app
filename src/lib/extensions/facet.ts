import type { Facet } from './types'

/** Define a new typed facet. */
export function defineFacet<Input, Output>(spec: {
  name: string
  defaultValue: Output
  combine: (inputs: readonly Input[]) => Output
}): Facet<Input, Output> {
  return {
    id: Symbol(spec.name),
    name: spec.name,
    defaultValue: spec.defaultValue,
    combine: spec.combine,
  }
}

/** Create a list-like facet where contributions are appended in resolved order. */
export function appendFacet<T>(name: string) {
  return defineFacet<T, readonly T[]>({
    name,
    defaultValue: [],
    combine: (inputs) => inputs,
  })
}

/** Create a facet where the highest-priority contribution wins. */
export function firstWinsFacet<T>(name: string, defaultValue: T) {
  return defineFacet<T, T>({
    name,
    defaultValue,
    combine: (inputs) => (inputs.length > 0 ? inputs[0] : defaultValue),
  })
}

/** Create a shallow object-merge facet for configuration fragments. */
export function mergeObjectsFacet<T extends object>(
  name: string,
  defaultValue: T
) {
  return defineFacet<Partial<T>, T>({
    name,
    defaultValue,
    combine: (inputs) => Object.assign({}, defaultValue, ...inputs),
  })
}
