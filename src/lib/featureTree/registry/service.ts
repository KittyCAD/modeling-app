import {
  featureNodes,
  bodyNodes,
  selectedNodes,
} from '@src/lib/featureTree/browserNodes'
import type { ExecutingEditor } from '@src/registry/contracts/projectSession'
import type { FeatureTreeService } from '@src/lib/featureTree/registry/contract'
import { featureTree } from '@src/lib/featureTree/registry/contract'
import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { computed, type ReadonlySignal } from '@preact/signals-core'
import { shouldDisableModelingForUnrenderedChanges } from '@src/lib/automaticRendering'
import { buildFeatureTreeState } from '@src/lib/featureTree/model'
import { projectSession } from '@src/registry/contracts/projectSession'
import { settingsService } from '@src/registry/contracts/settings'

export function createFeatureTreeService(
  executingEditor: ReadonlySignal<ExecutingEditor | undefined>,
  disabledForUnrenderedChanges: () => boolean
): FeatureTreeService {
  const model = computed(() => {
    const editor = executingEditor.value
    return buildFeatureTreeState(
      editor?.featureTree.value,
      editor?.code.value ?? '',
      editor?.isExecuting.value ?? false,
      disabledForUnrenderedChanges()
    )
  })
  const nodes = computed(() => featureNodes(model.value))
  return {
    model,
    featureNodes: nodes,
    featureNodesById: computed(
      () => new Map(nodes.value.map((node) => [node.id, node]))
    ),
    bodyNodes: computed(() => bodyNodes(model.value)),
    selectedIds: computed(() => selectedNodes(model.value)),
    defaultExpandedIds: computed(() =>
      model.value.operationRows
        .filter((row) => row.defaultOpen)
        .map((row) => row.id)
    ),
  }
}

export const featureTreeServiceExtension = defineRegistryItemFactory((ctx) => {
  const session = ctx.services.signal(projectSession)
  const settings = ctx.services.signal(settingsService)
  const service = createFeatureTreeService(
    computed(() => session.value?.executingEditor.value),
    () => {
      const currentSettings = settings.value?.current.value
      return currentSettings
        ? shouldDisableModelingForUnrenderedChanges({
            settings: currentSettings,
            hasEditsSinceLastExecution:
              session.value?.executingEditor.value?.hasEditsSinceLastExecution
                .value ?? false,
          })
        : false
    }
  )
  return {
    id: 'feature-tree.service',
    providesServices: [provideService(featureTree, service)],
  }
}, 'feature-tree.service')
