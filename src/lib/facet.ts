// Trying to learn lessons from the incredible work by
// @marijnh on CodeMirror V6: https://github.com/codemirror/state/blob/main/src/facet.ts

import { Signal } from '@preact/signals-core'

// and from https://marijnhaverbeke.nl/blog/facets.html
let nextID = 0

type FacetConfig<Input, Output> = {
  combine?: (value: Input[]) => Output
  compare?: (a: Output, b: Output) => boolean
  compareInput?: (a: Input, b: Input) => boolean
}

export type FacetReader<Output> = {
  /// @internal
  id: number
  /// @internal
  default: Output
  /// Dummy tag that makes sure TypeScript doesn't consider all object
  /// types as conforming to this type. Not actually present on the
  /// object.
  tag: Output
}

/** Generic helper functions to check every item in a pair of arrays for identity */
function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || (a.length == b.length && a.every((e, i) => e === b[i]))
}

export class Facet<Input, Output = readonly (Input | Signal<Input>)[]>
  implements FacetReader<Output>
{
  readonly id = nextID++
  readonly default: Output

  constructor(config: Required<FacetConfig<Input, Output>>) {
    this.default = config.combine([])
  }

  static define<I, O = readonly I[]>(config: FacetConfig<I, O>) {
    return new Facet({
      combine: config.combine || (((a: any) => a) as any),
      compareInput: config.compareInput || ((a: I, b: I) => a === b),
      compare:
        config.compare ||
        (!config.combine ? (sameArray as any) : (a, b) => a === b),
    })
  }

  declare tag: Output
}
