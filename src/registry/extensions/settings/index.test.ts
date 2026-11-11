import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import type { MachineManager } from '@src/lib/MachineManager'
import * as wasm from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { createSettings } from '@src/lib/settings/initialSettings'
import * as settingsUtils from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { commandSystemService } from '@src/registry/contracts/commands'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { routerService } from '@src/registry/contracts/router'
import { settingsService } from '@src/registry/contracts/settings'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import { createRouterRegistryService } from '@src/registry/extensions/router'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import type { Location } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import toast from 'react-hot-toast'
import settingsRegistryItem from '.'

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('settings extension', () => {
  it('contributes the settings status bar item', () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])

    expect(registry.get(statusBarGlobalItemsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        label: 'Settings',
        'data-testid': 'settings-link',
      }),
    ])

    registry[Symbol.dispose]()
  })

  it('builds a stable settings link for project file routes', () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])
    const [settingsItem] = registry.get(statusBarGlobalItemsValueSpec)

    if (
      !settingsItem ||
      'component' in settingsItem ||
      settingsItem.element !== 'link' ||
      typeof settingsItem.href !== 'function'
    ) {
      throw new Error('Expected the settings item to provide a link function')
    }

    const filePath = '/file/%2Fdocuments%2Fdemo-project%2Fmain.kcl'
    const location = (pathname: string) => ({ pathname }) as Location

    expect(settingsItem.href(location(filePath))).toBe(
      `${filePath}/settings?tab=project`
    )
    expect(settingsItem.href(location(`${filePath}/settings`))).toBe(
      `${filePath}/settings?tab=project`
    )
    expect(
      settingsItem.href(location('/file/%2Fdocuments%2Fdemo-project'), {
        activeFileRoutePath: filePath,
      })
    ).toBe(`${filePath}/settings?tab=project`)

    registry[Symbol.dispose]()
  })
})

describe('renderer settings command', () => {
  let dispose = () => {}
  afterEach(() => dispose())

  async function setup({
    active = false,
    saved = active,
  }: {
    active?: boolean
    saved?: boolean
  } = {}) {
    const initialSettings = createSettings()
    initialSettings.modeling.useLocalRenderer.user = saved
    vi.spyOn(settingsUtils, 'loadAndValidateSettings').mockResolvedValue({
      settings: initialSettings,
      configuration: {},
    })
    const save = vi
      .spyOn(settingsUtils, 'saveSettings')
      .mockResolvedValue(undefined)
    const wasmInstancePromise = Promise.resolve({} as ModuleType)
    const commands = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise,
        machineManager: {} as MachineManager,
      },
    }).start()
    const router = createRouterRegistryService()
    router.setLocation({
      pathname: '/file/renderer-test/main.kcl',
      search: '',
      hash: '',
      state: null,
      key: 'test',
    })
    const navigate = vi.fn().mockResolvedValue(undefined)
    router.setNavigate(navigate)
    const reload = vi
      .spyOn(window.location, 'reload')
      .mockImplementation(() => {})
    const registry = new Registry()
    dispose = () => {
      registry[Symbol.dispose]()
      commands.stop()
    }
    registry.configure([
      settingsRegistryItem,
      defineRegistryItem({
        id: 'test-settings-dependencies',
        provides: [provide(wasmPromiseValueSpec, wasmInstancePromise)],
        providesServices: [
          provideService(commandSystemService, {
            actor: commands,
            send: (event) => commands.send(event),
            useState: () => commands.getSnapshot(),
          }),
          provideService(fileOperationsService, testFileOperations),
          provideService(engineConnectionService, {
            manager: {
              connection: {},
              geometryOnly: active,
            } as ConnectionManager,
          }),
          provideService(routerService, router),
        ],
      }),
    ])
    const actor = registry.get(settingsService).actor
    await waitFor(actor, (state) => state.matches('idle'))
    const command = commands
      .getSnapshot()
      .context.commands.find(
        (command) => command.name === 'modeling.useLocalRenderer'
      )
    if (!command) throw new Error('Renderer command was not registered')
    return {
      actor,
      command,
      save,
      reload,
      navigate,
      router,
    }
  }

  it.each([false, true])(
    'saves queued renderer commands before restarting once (active: %s)',
    async (active) => {
      const { command, save, reload } = await setup({ active })
      const firstSave = Promise.withResolvers<undefined>()
      const secondSave = Promise.withResolvers<undefined>()
      save
        .mockReturnValueOnce(firstSave.promise)
        .mockReturnValueOnce(secondSave.promise)

      command.onSubmit({ level: 'user', value: !active })
      command.onSubmit({ level: 'user', value: !active })
      expect(reload).not.toHaveBeenCalled()
      firstSave.resolve(undefined)
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      expect(reload).not.toHaveBeenCalled()
      secondSave.resolve(undefined)
      await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    }
  )

  it('compares the selection with the live renderer, not the saved value', async () => {
    const { actor, command, reload } = await setup({
      active: false,
      saved: true,
    })
    command.onSubmit({ level: 'user', value: false })
    await waitFor(actor, (state) => state.matches('idle'))
    expect(reload).not.toHaveBeenCalled()
  })

  it.each(['write', 'serialization'] as const)(
    'reports a settings %s failure without restarting',
    async (failure) => {
      const { actor, command, save, reload } = await setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      if (failure === 'write') {
        save.mockRejectedValueOnce(new Error('disk full'))
      } else {
        save.mockRestore()
        vi.spyOn(wasm, 'serializeConfiguration').mockReturnValue(
          new Error('invalid settings')
        )
      }
      command.onSubmit({ level: 'user', value: true })
      await waitFor(actor, (state) => state.matches('idle'))
      await Promise.resolve()
      expect(reload).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Could not save settings'),
        expect.anything()
      )
    }
  )

  it('cancels the restart after a queued save fails, until the command is retried', async () => {
    const { actor, command, save, reload } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pendingSave = Promise.withResolvers<undefined>()
    save
      .mockReturnValueOnce(pendingSave.promise)
      .mockRejectedValueOnce(new Error('disk full'))
    command.onSubmit({ level: 'user', value: true })
    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'user', value: 'cm' },
    })
    pendingSave.resolve(undefined)
    await waitFor(actor, (state) => state.matches('idle'))
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledOnce()

    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'user', value: 'mm' },
    })
    await waitFor(actor, (state) => state.matches('idle'))
    expect(reload).not.toHaveBeenCalled()

    command.onSubmit({ level: 'user', value: true })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('uses the final renderer choice after queued changes finish saving', async () => {
    const { actor, command, save, reload } = await setup()
    const pendingSave = Promise.withResolvers<undefined>()
    save.mockReturnValueOnce(pendingSave.promise)
    command.onSubmit({ level: 'user', value: true })
    command.onSubmit({ level: 'user', value: false })
    pendingSave.resolve(undefined)
    await waitFor(actor, (state) => state.matches('idle'))
    expect(save).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('cancels a stale restart if the renderer changes while leaving Settings', async () => {
    const { actor, command, reload, navigate, router } = await setup()
    router.setLocation({
      ...router.getLocation(),
      pathname: '/file/renderer-test/main.kcl/settings',
    })
    const navigation = Promise.withResolvers<undefined>()
    navigate.mockReturnValueOnce(navigation.promise)
    command.onSubmit({ level: 'user', value: true })
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce())
    expect(reload).not.toHaveBeenCalled()

    command.onSubmit({ level: 'user', value: false })
    await waitFor(actor, (state) => state.matches('idle'))
    navigation.resolve(undefined)
    await navigation.promise
    expect(reload).not.toHaveBeenCalled()
  })

  it('leaves settings panel changes waiting for a manual restart', async () => {
    const { actor, reload } = await setup()
    actor.send({
      type: 'set.modeling.useLocalRenderer',
      data: { level: 'user', value: true },
    })
    await waitFor(actor, (state) => state.matches('idle'))
    expect(reload).not.toHaveBeenCalled()
  })
})
