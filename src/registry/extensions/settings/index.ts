import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import type { ProjectTitleService } from '@src/lib/projectTitle'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  getOnlySettingsFromContext,
  type SettingsActorType,
  settingsMachine,
} from '@src/machines/settingsMachine'
import { commandSystemService } from '@src/registry/contracts/commands'
import { homeProjectActionsService } from '@src/registry/contracts/homeProjects'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibrarySettingDefaultsValueSpec,
} from '@src/registry/contracts/projectLibraries'
import {
  type SettingsRegistryService,
  settingsService,
  settingsValueSpec,
} from '@src/registry/contracts/settings'
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

  const projectTitle: ProjectTitleService = {
    canUpdateTitle: (project) =>
      project.readWriteAccess &&
      Boolean(ctx.services.optional(homeProjectActionsService)),
    updateTitle: async (project, title) => {
      if (!project.readWriteAccess) {
        return Promise.reject(new Error('This project title cannot be edited.'))
      }

      const actions = ctx.services.optional(homeProjectActionsService)
      if (!actions) {
        return Promise.reject(new Error('Project actions are unavailable.'))
      }

      await actions.renameLocalProject(project, title)
    },
  }

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
        projectTitleCommand: projectTitle,
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
    projectTitle,
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

const settingsRegistryItem = defineRegistryItem({
  id: 'settings',
  provides: [
    provide(statusBarGlobalItemsValueSpec, {
      id: 'settings',
      element: 'link',
      icon: 'settings',
      href: (location) =>
        `${webSafeJoin([location.pathname, PATHS.SETTINGS])}${
          location.pathname.includes(PATHS.FILE) ? '?tab=project' : ''
        }`,
      'data-testid': 'settings-link',
      order: 1,
      label: 'Settings',
    }),
  ],
  uses: [settingsExtension],
})

export default settingsRegistryItem
