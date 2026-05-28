import type {
  PluginRecord,
  Registry,
  SlotToggleController,
} from '@kittycad/registry'
import { Toggle } from '@src/components/Toggle/Toggle'
import { useApp } from '@src/lib/boot'
import type { DynamicBooleanSetEvent } from '@src/lib/settings/settingsTypes'
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
    // This is how we will get the interaction map from the context
    // in the future whene franknoirot/editable-hotkeys is merged.
    // const { state } = useInteractionMapContext()

    return (
      <div className="relative overflow-y-auto pb-16">
        <div ref={scrollRef} className="flex flex-col gap-12">
          {props.plugins.map((plugin) => (
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
