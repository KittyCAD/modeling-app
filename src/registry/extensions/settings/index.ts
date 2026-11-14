import { signal } from '@preact/signals-core'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  getOnlySettingsFromContext,
  type SettingsActorType,
  settingsMachine,
} from '@src/machines/settingsMachine'
import { observations as commandsObservations } from '@src/registry/contracts/commands'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { observations as projectLibrariesObservations } from '@src/registry/contracts/projectLibraries'
import {
  observations as settingsObservations,
  type SettingsRegistryService,
  settingsService,
} from '@src/registry/contracts/settings'
import { statusBarGlobalItemsFacet } from '@src/registry/contracts/statusBar'
import { observations as wasmObservations } from '@src/registry/contracts/wasm'
import { useSelector } from '@xstate/react'
import {
  factory as defineFactory,
  contribute,
  type InputOf,
  provide,
  type Factory,
} from 'plankton'
import { createActor } from 'xstate'
export const settingsExtension = defineFactory({
  dependencies: {
    wasm: wasmObservations,
    commands: commandsObservations,
    settings: settingsObservations,
    projectLibraries: projectLibrariesObservations,
    fileOperations: fileOperationsObservations,
  },
  key: 'settings-extension',
  create: ({
    wasm: wasmInputs,
    commands: commandsInputs,
    settings: settingsInputs,
    projectLibraries: projectLibrariesInputs,
    fileOperations: fileOperationsInputs,
  }) => {
    const settingsSignal = signal<SettingsType>(createSettings())
    let settingsActor: SettingsActorType | undefined
    let settingsSubscription:
      | {
          unsubscribe: () => void
        }
      | undefined
    const getWasmPromise = () =>
      wasmInputs.wasmPromiseFacet.value ??
      Promise.reject(new Error('Missing WASM promise registry value.'))
    const ensureActor = () => {
      if (settingsActor) {
        return settingsActor
      }
      const commands = commandsInputs.commandSystemService.required()
      const extensionSettings = settingsInputs.settingsFacet.value
      const defaultProjectLibraries =
        projectLibrariesInputs.projectLibrarySettingDefaultsFacet.value
      const projectLibrarySettingDefaultPolicies =
        projectLibrariesInputs.projectLibrarySettingDefaultPoliciesFacet.value
      const actor = createActor(settingsMachine, {
        input: {
          ...createSettings(extensionSettings),
          commandBarActor: commands.actor,
          defaultProjectLibraries,
          projectLibrarySettingDefaultPolicies,
          extensionSettings,
          fileOperations: fileOperationsInputs.fileOperationsService.required(),
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
      items: [provide(settingsService, serviceImpl)],
      dispose: () => {
        settingsSubscription?.unsubscribe()
        settingsActor?.stop()
      },
    }
  },
}) satisfies Factory
const settingsRegistryItem = [
  contribute(
    statusBarGlobalItemsFacet,
    (): InputOf<typeof statusBarGlobalItemsFacet> =>
      ({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        href: (location, { activeFileRoutePath } = {}) => {
          const pathname = location.pathname
          const routePath =
            !pathname.includes(PATHS.SETTINGS) &&
            pathname.includes(PATHS.FILE) &&
            activeFileRoutePath
              ? activeFileRoutePath
              : pathname
          const settingsPath = pathname.includes(PATHS.SETTINGS)
            ? pathname
            : webSafeJoin([routePath, makeUrlPathRelative(PATHS.SETTINGS)])
          return `${settingsPath}${routePath.includes(PATHS.FILE) ? '?tab=project' : ''}`
        },
        'data-testid': 'settings-link',
        order: 1,
        label: 'Settings',
      }) satisfies InputOf<typeof statusBarGlobalItemsFacet>
  ),
  settingsExtension,
]
export default settingsRegistryItem
