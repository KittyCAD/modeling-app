import {
  defineContract,
  defineService,
  defineValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { Group } from 'three'

export interface ProjectService {
  readonly project: ZDSProject
  readonly settings: ReadonlySignal<SettingsType>
  readonly sketchSolveScenePlugins: ReadonlySignal<SketchSolveScenePlugin[]>
}

export interface SketchSolveScenePluginContext {
  sceneInfra: SceneInfra
  sketchSolveGroup: Group
  sceneGraphDelta: SceneGraphDelta
  sketchId: number
  settings: SettingsType
}

export interface SketchSolveScenePlugin {
  id: string
  onSketchSceneGraphUpdate: (context: SketchSolveScenePluginContext) => void
}

const projectContract = defineContract({
  projectService: defineService<ProjectService>('project'),
  sketchSolveScenePluginsValueSpec: defineValueSpec<
    SketchSolveScenePlugin,
    SketchSolveScenePlugin[]
  >({
    name: 'project.sketch-solve-scene-plugins',
    defaultValue: [],
    combine: (plugins) => [...plugins],
  }),
})

export const { projectService, sketchSolveScenePluginsValueSpec } =
  projectContract
