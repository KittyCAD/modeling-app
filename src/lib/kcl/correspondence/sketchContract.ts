import type { ReadonlySignal } from '@preact/signals-core'
import type { SceneGraph } from '@rust/kcl-lib/bindings/FrontendApi'
import type { ExecState, SourceRange } from '@src/lang/wasm'
import type { KclSourceSnapshot } from '@src/lib/kcl/sources'
import type { EntityStyle } from '@src/lib/scene/entityStyling'

/** Native object IDs belong to one rendered sketch graph and its paired source revision. */
export interface SketchCorrespondenceSnapshot {
  readonly identity: symbol
  readonly sketchId: number
  readonly graph: SceneGraph
  readonly output: { readonly src: string; readonly contents: string }
  readonly sources: KclSourceSnapshot | undefined
  readonly filenames: ExecState['filenames']
}
export interface SketchCorrespondenceLayer {
  readonly sourceViewId: symbol
  readonly style: EntityStyle
  readonly ids: readonly number[]
}
/** The native session lends source queries and projection; the bridge cannot mutate solver selection or invoke native operations. */
export interface SketchCorrespondenceEndpoint {
  readonly snapshot: ReadonlySignal<SketchCorrespondenceSnapshot | undefined>
  selectedSources: (
    snapshot: SketchCorrespondenceSnapshot
  ) => readonly SourceRange[]
  targetsForCode: (
    snapshot: SketchCorrespondenceSnapshot,
    range: SourceRange
  ) => readonly number[]
  project: (
    snapshot: SketchCorrespondenceSnapshot | undefined,
    layers: readonly SketchCorrespondenceLayer[]
  ) => void
}
