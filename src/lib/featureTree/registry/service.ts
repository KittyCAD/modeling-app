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
  return { model }
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
