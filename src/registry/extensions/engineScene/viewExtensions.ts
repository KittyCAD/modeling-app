import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ComponentType } from 'react'

export interface EngineSceneViewExtension {
  id: string
  order?: number
  Component: ComponentType
}

export interface SceneControlsViewExtension {
  id: string
  order?: number
  Component: ComponentType
}

type OrderedViewExtension = {
  id: string
  order?: number
}

const byOrder = <T extends OrderedViewExtension>(a: T, b: T) =>
  (a.order ?? 0) - (b.order ?? 0)

const combineViewExtensions = <T extends OrderedViewExtension>(
  viewExtensions: readonly T[]
) => {
  const seen = new Set<string>()
  return viewExtensions
    .filter((viewExtension) => {
      if (seen.has(viewExtension.id)) {
        return false
      }
      seen.add(viewExtension.id)
      return true
    })
    .toSorted(byOrder)
}

const engineSceneViewExtensionsContract = defineContract({
  viewExtensionsValueSpec: defineValueSpec<
    EngineSceneViewExtension,
    readonly EngineSceneViewExtension[]
  >({
    name: 'engine-scene.view-extensions',
    defaultValue: [],
    combine: combineViewExtensions,
  }),
  sceneControlsViewExtensionsValueSpec: defineValueSpec<
    SceneControlsViewExtension,
    readonly SceneControlsViewExtension[]
  >({
    name: 'engine-scene.scene-controls-view-extensions',
    defaultValue: [],
    combine: combineViewExtensions,
  }),
})

export const { sceneControlsViewExtensionsValueSpec, viewExtensionsValueSpec } =
  engineSceneViewExtensionsContract
