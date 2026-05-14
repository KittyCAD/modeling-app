import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { SceneGraphDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { Group } from 'three'

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

export const sketchSolveSceneContract = defineContract({
  sketchSolveScenePluginsValueSpec: defineValueSpec<
    SketchSolveScenePlugin,
    SketchSolveScenePlugin[]
  >({
    name: 'sketch-solve-scene-plugins',
    defaultValue: [],
    combine: (plugins) => [...plugins],
  }),
})

export const { sketchSolveScenePluginsValueSpec } = sketchSolveSceneContract
