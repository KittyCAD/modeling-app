import type { Feature } from '@kittycad/lib'
import { Toggle } from '@src/components/Toggle/Toggle'
import { CustomIcon } from '@src/components/CustomIcon'
import { useSignals } from '@preact/signals-react/runtime'
import { InstalledPluginsSection } from '@src/lib/communityPlugins/InstalledPlugins'
import { useApp } from '@src/lib/boot'
import type { Setting } from '@src/lib/settings/Setting'
import type { DynamicBooleanSetEvent } from '@src/lib/settings/settingsTypes'
import { shouldHideSetting } from '@src/lib/settings/settingsUtils'
import { userFeaturesContextHas } from '@src/machines/userFeaturesMachine'
import {
  type ZdsPluginActivationSetting,
  zdsPluginActivationSettingsFacet,
} from '@src/registry/createZdsPlugin'
import type { PluginController, PluginRecord, Registry } from 'plankton'
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
      zdsPluginActivationSettingsFacet
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
      return (
        !setting ||
        !shouldHideSetting(setting, 'user', settingsContext, hasFeature)
      )
    })

    return (
      <div
        ref={scrollRef}
        className="min-w-0 overflow-y-auto pb-12 text-default"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-1 py-5 sm:px-4">
          <header className="flex gap-4 border-b b-4 pb-6">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CustomIcon
                name="function"
                aria-hidden="true"
                className="h-7 w-7"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
              <p className="mt-2 text-sm leading-6 text-2">
                Manage built-in features and the community plugins you have
                installed.
              </p>
            </div>
          </header>
          <InstalledPluginsSection registry={props.registry} />
          <section
            aria-label="Built-in plugins"
            className="flex flex-col gap-4 border-t b-4 pt-6"
          >
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Built-in plugins</h2>
                <span className="rounded-full bg-3/50 px-2 py-0.5 text-xs text-2">
                  {visiblePlugins.length}
                </span>
              </div>
              <p className="mt-1 text-sm leading-6 text-2">
                Optional features included with ZDS. Changes are saved to your
                user settings.
              </p>
            </div>
            {visiblePlugins.map((plugin) => (
              <PluginItem
                key={plugin.id}
                plugin={plugin}
                resolvedService={props.registry.required(plugin.service)}
                activationSetting={activationSettings.find(
                  (setting) => setting.pluginId === plugin.id
                )}
              />
            ))}
            {visiblePlugins.length === 0 && (
              <p className="text-sm text-2">No built-in plugins available.</p>
            )}
          </section>
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
  resolvedService: PluginController
  activationSetting?: ZdsPluginActivationSetting
}) {
  useSignals()
  const app = useApp()
  const setting = activationSetting ?? {
    category: 'plugins',
    settingName: plugin.id,
  }

  return (
    <article
      aria-label={plugin.title}
      className="flex min-w-0 flex-wrap items-start justify-between gap-4 rounded-xl border b-4 bg-default p-5"
    >
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="break-words text-base font-semibold">{plugin.title}</h3>
        <p className="mt-2 break-words text-sm leading-6 text-2">
          {plugin.description}
        </p>
      </div>
      <div
        role="group"
        aria-label={`${plugin.title} activation`}
        className="flex shrink-0 flex-col items-end gap-2"
      >
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
    </article>
  )
}
