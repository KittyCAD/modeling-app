import type { Feature } from '@kittycad/lib'
import type {
  PluginRecord,
  Registry,
  SlotToggleController,
} from '@kittycad/registry'
import { Toggle } from '@src/components/Toggle/Toggle'
import { useApp } from '@src/lib/boot'
import type { Setting } from '@src/lib/settings/initialSettings'
import type { DynamicBooleanSetEvent } from '@src/lib/settings/settingsTypes'
import { shouldHideSetting } from '@src/lib/settings/settingsUtils'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  type ZdsPluginActivationSetting,
  zdsPluginActivationSettingsValueSpec,
} from '@src/registry/createZdsPlugin'
import type { ForwardedRef } from 'react'
import { forwardRef } from 'react'

type PluginsListProps = {
  plugins: readonly PluginRecord[]
  registry: Registry
}

export const PluginsList = forwardRef(
  (props: PluginsListProps, scrollRef: ForwardedRef<HTMLDivElement>) => {
    const app = useApp()
    const settingsContext = app.settings.useSettings()
    const userFeaturesContext = app.userFeatures.useContext()
    const hasFeature = (feature: Feature) =>
      userFeaturesContextHas(userFeaturesContext, feature, false)
    const activationSettings = props.registry.get(
      zdsPluginActivationSettingsValueSpec
    )

    // A plugin's activation toggle is a settings entry, so it obeys the same
    // visibility rules: hide it here whenever that setting is hidden on this
    // platform/level or gated behind a feature the user lacks. This keeps the
    // plugins list in sync with the settings panel and command bar instead of
    // hardcoding per-plugin exceptions (e.g. cloud sync, which is web-only
    // infrastructure and must not expose a toggle there).
    const settingsByCategory = settingsContext as unknown as Record<
      string,
      Record<string, Setting | undefined> | undefined
    >
    const visiblePlugins = props.plugins.filter((plugin) => {
      const activation = activationSettings.find(
        (setting) => setting.pluginId === plugin.id
      )
      if (!activation) {
        return true
      }

      const setting =
        settingsByCategory[activation.category]?.[activation.settingName]
      return !setting || !shouldHideSetting(setting, 'user', hasFeature)
    })

    // This is how we will get the interaction map from the context
    // in the future whene franknoirot/editable-hotkeys is merged.
    // const { state } = useInteractionMapContext()

    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-12">
          {visiblePlugins.map((plugin) => (
            <PluginItem
              key={plugin.id}
              plugin={plugin}
              resolvedService={props.registry.get(plugin.service)}
              activationSetting={props.registry
                .get(zdsPluginActivationSettingsValueSpec)
                .find((setting) => setting.pluginId === plugin.id)}
            />
          ))}
        </div>
      </div>
    )
  }
)

function PluginItem({
  plugin,
  resolvedService,
  activationSetting,
}: {
  plugin: PluginRecord
  resolvedService: SlotToggleController
  activationSetting?: ZdsPluginActivationSetting
}) {
  const app = useApp()
  const setting = activationSetting ?? {
    category: 'plugins',
    settingName: plugin.id,
  }

  return (
    <div className="my-2">
      <div className="flex gap-2 mb-2">
        <h2 className="text-lg bold flex-1">{plugin.title}</h2>
        <Toggle
          name={`plugin-toggle-${plugin.id}`}
          checked={resolvedService.active.value || false}
          onChange={() => {
            const nextActive = !resolvedService.active.value
            const event: DynamicBooleanSetEvent = {
              type: `set.${setting.category}.${setting.settingName}`,
              data: {
                level: 'user',
                value: nextActive,
              },
            }

            app.settings.actor.send(event)
          }}
          className="flex-none"
        />
      </div>
      <p className="text-2 text-sm">{plugin.description}</p>
    </div>
  )
}
