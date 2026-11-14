import type { ModelingCmd, UnitLength } from '@kittycad/lib'
import type { ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { createContext, useContext, type ReactNode } from 'react'
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
const Context = createContext<SceneToolsHost | null>(null)
export function SceneToolsProvider({
  host,
  children,
}: {
  host: SceneToolsHost
  children: ReactNode
}) {
  return <Context.Provider value={host}>{children}</Context.Provider>
}
export function useSceneToolsHost(): SceneToolsHost {
  const host = useContext(Context)
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw -- A missing provider is a component wiring error, not a tool operation failure.
  if (!host) throw new Error('Scene tools require an explicit scene host')
  return host
}
