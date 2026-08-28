import { defineContract, defineService } from '@kittycad/registry'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { ReadonlySignal } from '@preact/signals'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'

/**
 * A program as it was last read, with the text it was read from.
 *
 * The source travels with the AST because offsets mean nothing without it. This
 * is the *last executed* program, so it lags the buffer while somebody is typing
 * — which is the honest state of affairs and why a consumer comparing offsets
 * against a live cursor has the text it would need to notice.
 */
export interface ExecutedProgram {
  source: string
  ast: Program
}

/**
 * What the last execution built, and which code built it.
 *
 * kcl-lib returns an artifact graph with every run and it has been carried as an
 * opaque value until something needed it. Selection is that something: the engine
 * answers a click with an entity id, and this is the only thing that can say
 * which line of KCL the entity came from.
 *
 * Published by the KCL executor rather than added to `BufferExecutionState`,
 * because the coordinator is deliberately generic — an executor-specific payload
 * belongs to whoever understands it.
 */
export interface KclSceneService {
  /** Artifacts from the most recent run, by id. Empty before the first one. */
  readonly artifacts: ReadonlySignal<ArtifactMap>
  artifactFor(entityId: string): Artifact | undefined
  /** Where in the source an entity came from, following the graph as needed. */
  sourceRangeFor(entityId: string): SourceRange | null
  /**
   * The program the last run read. Null until something has been executed.
   *
   * Published because the AST answers questions the artifact graph cannot: which
   * sketch block an offset is inside, what a binding produces, which names are
   * taken. Parsing it again per question would mean loading WASM to answer
   * "should the Sketch mode button be enabled".
   */
  readonly program: ReadonlySignal<ExecutedProgram | null>
}

export const kclSceneContract = defineContract({
  kclSceneService: defineService<KclSceneService>('kclScene.service'),
})

export const { kclSceneService } = kclSceneContract
