// Trying to learn lessons from the incredible work by
// @marijnh on CodeMirror V6: https://github.com/codemirror/state/blob/main/src/facet.ts

import { computed, ReadonlySignal, signal, Signal } from '@preact/signals-core'
import { StatusBarConfig } from './extension'

// and from https://marijnhaverbeke.nl/blog/facets.html
let nextID = 0

export type FacetConfig<Input, Output> = {
  combine?: (value: Signal<Input>[]) => Output
}

export type ZDSFacetReader<Output> = {
  /// @internal
  id: number
  /// @internal
  signal: ReadonlySignal<Output>
  /// Dummy tag that makes sure TypeScript doesn't consider all object
  /// types as conforming to this type. Not actually present on the
  /// object.
  tag: Output
}

/** Generic helper functions to check every item in a pair of arrays for identity */
function sameArray<T>(a: readonly T[], b: readonly T[]) {
  return a == b || (a.length == b.length && a.every((e, i) => e === b[i]))
}

export class ZDSFacet<Input = unknown, Output = readonly Input[]>
  implements ZDSFacetReader<Output>
{
  readonly id = nextID++
  readonly signal: ReadonlySignal<Output>
  private inputs: Signal<Input>[] = []

  constructor(config: Required<FacetConfig<Input, Output>>) {
    this.signal = computed(() => config.combine(this.inputs))
  }

  static define<I, O = readonly I[]>(config?: FacetConfig<I, O>) {
    return new ZDSFacet({
      combine:
        config?.combine ||
        ((a: Signal<I>[]) => a.map((a: Signal<I>) => a.value) as O),
    })
  }

  extendDynamic(input: Signal<Input>) {
    this.inputs.push(input)
    return this
  }
  extendStatic(input: Input) {
    this.inputs.push(signal(input))
    return this
  }

  // TS shenanigans
  declare extension: Extension
  declare tag: Output
}

/// Extension values can be
/// [provided](#state.EditorStateConfig.extensions) when creating a
/// state to attach various kinds of configuration and behavior
/// information. They can either be built-in extension-providing
/// objects, such as [state fields](#state.StateField) or [facet
/// providers](#state.Facet.of), or objects with an extension in its
/// `extension` property. Extensions can be nested in arrays
/// arbitrarily deep—they will be flattened when processed.
export type Extension = { extension: Extension } | readonly Extension[]

type ExtensionInfo = {
  title: string
  description: string
}

/**
 * A configurable extension has the ability to be reconfigured at runtime
 */
export class ExtensionConfigurable {
  private extensionSignal = signal<Extension>([])
  get extension() {
    return this.extensionSignal.value
  }

  constructor(
    public meta: ExtensionInfo,
    initialExtensionValue?: Extension
  ) {
    if (initialExtensionValue) {
      this.extensionSignal.value = initialExtensionValue
    }
  }

  reconfigure(newExtension: Extension) {
    this.extensionSignal.value = newExtension
  }
}
