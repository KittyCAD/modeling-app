import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  pluginsValueSpec,
  provide,
} from '@kittycad/registry'
import { computed, effect } from '@preact/signals'
import { pluginActivationsValueSpec } from '@src/contracts/plugins'
import { runtimeService } from '@src/contracts/runtime'
import {
  settingsSectionsValueSpec,
  settingsService,
} from '@src/contracts/settings'

/**
 * Synchronizes persisted activation settings into stable plugin controllers.
 *
 * It must remain outside every plugin slot: disabling a plugin cannot remove
 * the mechanism that would enable it again.
 */
export default defineRegistryItemFactory((ctx) => {
  const plugins = computed(() => ctx.valueSpecs.get(pluginsValueSpec))
  const activations = computed(() =>
    ctx.valueSpecs.get(pluginActivationsValueSpec)
  )
  let stop: (() => void) | undefined
  let disposed = false

  queueMicrotask(() => {
    if (disposed) {
      return
    }
    const settings = ctx.services.get(settingsService)
    const runtime = ctx.services.get(runtimeService)

    stop = effect(() => {
      for (const activation of activations.value) {
        const plugin = plugins.value.find(
          (candidate) => candidate.id === activation.pluginId
        )
        if (!plugin) {
          continue
        }

        const forced = activation.forceEnabledOn?.includes(
          runtime.info.value.target
        )
        if (!forced && !settings.hydrated.value) {
          continue
        }

        const desired = forced || settings.value(activation.setting).value
        const controller = ctx.services.get(plugin.service)
        if (desired === controller.active.value) {
          continue
        }
        if (desired) {
          controller.enable()
        } else {
          controller.disable()
        }
      }
    })
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'pluginManagement',
      dispose: () => {
        disposed = true
        stop?.()
      },
      provides: [
        provide(settingsSectionsValueSpec, {
          id: 'plugins',
          title: 'Plugins',
          description:
            'Turn optional application capabilities on or off. Changes are saved to your user settings.',
          icon: 'gear',
          order: 40,
          levels: ['user'],
        }),
      ],
    }),
  }
}, 'pluginManagement')
