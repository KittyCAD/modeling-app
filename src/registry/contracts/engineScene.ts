import { defineContract, defineValueSpec } from '@kittycad/registry'
import type { ComponentType } from 'react'

export interface EngineSceneOverlayItem {
  id: string
  order?: number
  Component: ComponentType
}

const sortByOrderProperty = (inputs: readonly EngineSceneOverlayItem[]) =>
  inputs.toSorted((a, b) => (a.order || 0) - (b.order || 0))

export const engineSceneContract = defineContract({
  engineSceneOverlayItemsValueSpec: defineValueSpec<
    EngineSceneOverlayItem,
    EngineSceneOverlayItem[]
  >({
    name: 'engine-scene-overlay-items',
    defaultValue: [],
    combine: sortByOrderProperty,
  }),
})

export const { engineSceneOverlayItemsValueSpec } = engineSceneContract
