import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { FeatureTreeModel } from '@src/lib/featureTree/model'

/** Derived data follows the current executing editor, never a captured singleton. */
export interface FeatureTreeService {
  readonly model: ReadonlySignal<FeatureTreeModel>
}
export const featureTreeContract = defineContract({
  featureTree: defineService<FeatureTreeService>('feature-tree.service'),
})
export const { featureTree } = featureTreeContract

import { SCENE_BROWSER_FOCUSED_SCOPE } from '@src/lib/sceneBrowser/registry/contract'

export const FEATURE_TREE_FOCUSED_SCOPE = SCENE_BROWSER_FOCUSED_SCOPE
export const FEATURE_TREE_COMMANDS = {
  actions: 'zds.featureTree.focusActions',
  row: 'zds.featureTree.focusRow',
  menu: 'zds.featureTree.contextMenu',
  edit: 'zds.featureTree.edit',
} as const

/** Requests the ZDS edit flow for a row without synthesizing a mouse event. */
export const FEATURE_TREE_EDIT_EVENT = 'zds-feature-tree-edit'
