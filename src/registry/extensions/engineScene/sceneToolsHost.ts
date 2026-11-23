import type { ModelingCmd, UnitLength } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import type { createMeasurementToolService } from './measurementToolService'
import type { createPhysicalAnalysisService } from './physicalAnalysis/physicalAnalysisService'

/** Tool inputs belong to a captured editor execution; panel state belongs to its view. */
export interface SceneToolsHost {
  selections: Selections
  artifactGraph: ArtifactGraph
  idle: boolean
  executing: boolean
  unit: UnitLength
  executionKey: string
  sendModelingCommand: (command: ModelingCmd) => Promise<unknown>
  container: HTMLElement | null
  measurement: ReturnType<typeof createMeasurementToolService>
  physicalAnalysis: ReturnType<typeof createPhysicalAnalysisService>
}
