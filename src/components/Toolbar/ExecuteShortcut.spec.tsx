import { signal } from '@preact/signals-core'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { Suspense, type ComponentType } from 'react'
import { createActor } from 'xstate'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: () => environment.app,
  useSingletons: () => ({ kclManager: environment.input.kclManager }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => {
    const state = environment.actor.getSnapshot()
    return {
      state,
      context: state.context,
      actor: environment.actor,
      send: (event: Parameters<typeof environment.actor.send>[0]) =>
        environment.actor.send(event),
    }
  },
}))
vi.mock('@src/hooks/usePlatform', () => ({ default: () => 'linux' }))

import { Toolbar } from '@src/Toolbar'
import { FeatureTreePaneContents } from '@src/lib/featureTree/FeatureTreePane'
import { createTestSettings } from '@src/lib/kcl/testFixtures'
import { createSettings } from '@src/lib/settings/initialSettings'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import * as settingsUtils from '@src/lib/settings/settingsUtils'
import { modelingMachine } from '@src/machines/modelingMachine'
import {
  DEFAULT_COMMAND_SCOPES,
  MODE_MODELING_COMMAND_SCOPE,
} from '@src/registry/contracts/commands'
import {
  createKeymapTree,
  keymapService,
  resolveKeymapItems,
  type KeymapBinding,
  type KeymapItem,
} from '@src/registry/contracts/keymap'
import { projectSession } from '@src/registry/contracts/projectSession'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { buildModelingMachineInput } from '@src/unitTestUtils'

beforeEach(() => {
  vi.spyOn(settingsUtils, 'loadAndValidateSettings').mockResolvedValue({
    settings: createSettings(),
    configuration: {},
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

let environment: Awaited<ReturnType<typeof setup>>
async function setup() {
  const input = await buildModelingMachineInput()
  const actor = createActor(
    modelingMachine.provide({
      actions: {
        'set modeling idle double-click callback': () => {},
        'restore modeling camera controls': () => {},
        'reset client scene mouse handlers': () => {},
        'hide default planes': () => {},
      },
    }),
    { input }
  ).start()
  onTestFinished(() => {
    actor.stop()
  })
  const settings = createTestSettings()
  settings.current.value = createSettings({
    textEditor: {
      automaticallyRender: defineBooleanExtensionSetting({
        defaultValue: false,
        description: 'Automatically render changes',
      }),
    },
  })
  input.kclManager.hasEditsSinceLastExecutionSignal.value = true
  const execute = vi.fn(async () => {})
  const executingEditor = signal({
    ...input.kclManager.execution,
    executeCode: execute,
  })
  const defaults: KeymapItem[] = [
    {
      id: 'editor.render',
      command: APP_COMMAND_IDS.editor.render,
      title: 'Render code',
      source: 'Base',
      when: [MODE_MODELING_COMMAND_SCOPE],
      keystrokes: ['mod+s'],
    },
  ]
  const keymapTree = signal(createKeymapTree(defaults))
  const keymapAvailable = signal(true)
  const keymap = {
    keymap: keymapTree,
    getCurrentScopes: () => [MODE_MODELING_COMMAND_SCOPE],
  }
  const scopes = signal(DEFAULT_COMMAND_SCOPES)
  const app = {
    settings,
    layout: {},
    commands: {
      actor: input.commandBarActor,
      send: (event: Parameters<typeof input.commandBarActor.send>[0]) =>
        input.commandBarActor.send(event),
    },
    userFeatures: { useHas: () => false },
    registry: {
      required: () => keymap,
      optional: (token: unknown) =>
        token === projectSession
          ? { executingEditor }
          : token === keymapService && keymapAvailable.value
            ? keymap
            : undefined,
      observe: () => scopes,
    },
  }
  const setBindings = (bindings: KeymapBinding[]) =>
    act(() => {
      keymapTree.value = createKeymapTree(
        resolveKeymapItems(defaults, { version: 2, bindings })
      )
    })
  return { app, input, actor, execute, setBindings, keymapAvailable }
}

async function show(Component: ComponentType) {
  await act(async () => {
    render(
      <Suspense fallback={<p>Loading</p>}>
        <Component />
      </Suspense>
    )
  })
}

it.each([
  { name: 'toolbar', Component: Toolbar },
  { name: 'Feature Tree', Component: FeatureTreePaneContents },
])(
  'updates the $name Execute hint after remapping and removes it when unbound',
  async ({ Component }) => {
    environment = await setup()
    await show(Component)
    const execute = screen.getByRole('button', { name: /Execute Ctrl\+S$/ })
    const remapping: KeymapBinding = {
      command: APP_COMMAND_IDS.editor.render,
      when: [MODE_MODELING_COMMAND_SCOPE],
      keystrokes: ['mod+shift+r'],
    }
    environment.setBindings([remapping])
    expect(execute).toHaveAccessibleName(/Execute Ctrl\+Shift\+R$/)
    expect(within(execute).queryByText('Ctrl+S')).not.toBeInTheDocument()
    fireEvent.click(execute)
    expect(environment.execute).toHaveBeenCalledOnce()
    environment.setBindings([
      remapping,
      {
        ...remapping,
        command: '-' + APP_COMMAND_IDS.editor.render,
      },
    ])
    expect(execute).toHaveAccessibleName(/Execute$/)
    expect(execute.querySelector('kbd')).toBeNull()
    fireEvent.click(execute)
    expect(environment.execute).toHaveBeenCalledTimes(2)
  }
)

it('does not invent a Feature Tree shortcut when no keymap service is installed', async () => {
  environment = await setup()
  environment.keymapAvailable.value = false
  await show(FeatureTreePaneContents)
  const execute = screen.getByRole('button', { name: /Execute$/ })
  expect(execute.querySelector('kbd')).toBeNull()
  fireEvent.click(execute)
  expect(environment.execute).toHaveBeenCalledOnce()
})
