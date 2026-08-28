import { defineContract, defineService } from '@kittycad/registry'
import type { Artifact } from '@rust/kcl-lib/bindings/Artifact'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'
import type { ReadonlySignal } from '@preact/signals'
import type { ArtifactMap } from '@src/lib/kcl/artifacts'

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
}

export const kclSceneContract = defineContract({
  kclSceneService: defineService<KclSceneService>('kclScene.service'),
})

export const { kclSceneService } = kclSceneContract
