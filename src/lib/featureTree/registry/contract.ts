import type { BrowserNode } from '@src/lib/featureTree/browserNodes'
import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { FeatureTreeModel } from '@src/lib/featureTree/model'

/** Derived data follows the current executing editor, never a captured singleton. */
export interface FeatureTreeService {
  readonly model: ReadonlySignal<FeatureTreeModel>
  readonly featureNodesById: ReadonlySignal<ReadonlyMap<string, BrowserNode>>
  readonly featureNodes: ReadonlySignal<readonly BrowserNode[]>
  readonly bodyNodes: ReadonlySignal<readonly BrowserNode[]>
  readonly selectedIds: ReadonlySignal<readonly string[]>
  readonly defaultExpandedIds: ReadonlySignal<readonly string[]>
}
export const featureTreeContract = defineContract({
  featureTree: defineService<FeatureTreeService>('feature-tree.service'),
})
export const { featureTree } = featureTreeContract
