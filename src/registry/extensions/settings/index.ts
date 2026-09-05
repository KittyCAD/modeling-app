import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  type SettingsActorType,
  getOnlySettingsFromContext,
  settingsMachine,
} from '@src/machines/settingsMachine'
import { commandSystemService } from '@src/registry/contracts/commands'
import { navigationService } from '@src/registry/contracts/navigation'
import {
  type SettingsRegistryService,
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import { createActor } from 'xstate'

export const settingsExtension = defineRegistryItemFactory((ctx) => {
  const settingsSignal = signal<SettingsType>(createSettings())
  let settingsActor: SettingsActorType | undefined
  let settingsSubscription: { unsubscribe: () => void } | undefined

  const getWasmPromise = () =>
    ctx.valueSpecs.get(wasmPromiseValueSpec) ??
    Promise.reject(new Error('Missing WASM promise registry value.'))

  const ensureActor = () => {
    if (settingsActor) {
      return settingsActor
    }

    const commands = ctx.services.get(commandSystemService)
    const extensionSettings = ctx.valueSpecs.get(settingsValueSpec)
    const defaultProjectLibraries = ctx.valueSpecs.get(
      projectLibrarySettingDefaultsValueSpec
    )
    const projectLibrarySettingDefaultPolicies = ctx.valueSpecs.get(
      projectLibrarySettingDefaultPoliciesValueSpec
    )
    const actor = createActor(settingsMachine, {
      input: {
        ...createSettings(extensionSettings),
        commandBarActor: commands.actor,
        defaultProjectLibraries,
        projectLibrarySettingDefaultPolicies,
        extensionSettings,
        wasmInstancePromise: getWasmPromise(),
      },
    }).start()

    settingsSignal.value = getOnlySettingsFromContext(
      actor.getSnapshot().context
    )
    settingsSubscription = actor.subscribe((snapshot) => {
      settingsSignal.value = getOnlySettingsFromContext(snapshot.context)
    })
    settingsActor = actor
    return settingsActor
  }

  const serviceImpl: SettingsRegistryService = {
    get actor() {
      return ensureActor()
    },
    get current() {
      ensureActor()
      return settingsSignal
    },
    get: () => {
      ensureActor()
      return settingsSignal.value
    },
    send: (...args: Parameters<SettingsActorType['send']>) =>
      ensureActor().send(...args),
    useSettings: () =>
      useSelector(ensureActor(), (state) => {
        return getOnlySettingsFromContext(state.context)
      }),
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'settings-extension',
      providesServices: [provideService(settingsService, serviceImpl)],
      dispose: () => {
        settingsSubscription?.unsubscribe()
        settingsActor?.stop()
      },
    }),
  }
}, 'settings-extension')

const settingsRegistryItem = defineRegistryItemFactory(
  (ctx) => ({
    item: defineRuntimeRegistryItem({
      id: 'settings',
      provides: [
        /*
         * Still a link, and the `href` stays.
         *
         * Following the href alone is no longer enough: once the URL is derived
         * from state it changes the URL and nothing else, so the writer
         * recomputes the old path and the panel never opens. `onClick` tells
         * the app, and then the two agree about where the click leads.
         *
         * Worth saying why this is not a button, since opening settings is an
         * action rather than a destination and a button is the tidier model:
         * `testing-settings` reaches this via
         * `getByRole('link', { name: 'Settings' })`. I did convert it, on the
         * strength of the `data-testid` being unchanged, and turned two passing
         * tests red. The DOM contract is not mine to rewrite in passing.
         */
        provide(statusBarGlobalItemsValueSpec, {
          id: 'settings',
          element: 'link',
          icon: 'settings',
          href: (location) => {
            const pathname = location.pathname
            const settingsPath = pathname.includes(PATHS.SETTINGS)
              ? pathname
              : webSafeJoin([pathname, makeUrlPathRelative(PATHS.SETTINGS)])

            return `${settingsPath}${pathname.includes(PATHS.FILE) ? '?tab=project' : ''}`
          },
          onClick: () => {
            const navigation = ctx.services.optional(navigationService)
            if (!navigation) return

            const overProject = navigation.location.peek().kind === 'project'
            navigation.openSettings(
              overProject ? { tab: 'project' } : undefined
            )
          },
          'data-testid': 'settings-link',
          order: 1,
          label: 'Settings',
        }),
      ],
      uses: [settingsExtension],
    }),
  }),
  'settings-status-bar-item'
)

export default settingsRegistryItem
