import type { CameraShortcutHints } from '@src/lib/cameraViewCommands'
import { createSceneSelection } from '@src/lib/scene/selection'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { signal, type ReadonlySignal } from '@preact/signals-core'
import { factory, provide, Registry, service } from 'plankton'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { CameraControls } from '@src/clientSideScene/CameraControls'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type { AttachCameraViewport } from '@src/lib/kcl/modeling/cameraCommands'
import {
  cameraCommands,
  MODELING_VIEW_FOCUSED_SCOPE,
} from '@src/lib/kcl/registry/cameraCommands'
import {
  createTestKclScene,
  createTestSettings,
} from '@src/lib/kcl/testFixtures'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import { Themes } from '@src/lib/theme'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  commandsFacet,
  commandSystemService,
} from '@src/registry/contracts/commands'
import {
  KEYMAP_SCHEMA_VERSION,
  keymapService,
} from '@src/registry/contracts/keymap'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { commandsExtension } from '@src/registry/extensions/commands'
import keymapExtension from '@src/registry/extensions/keymap'
import { machineManagerExtension } from '@src/registry/extensions/machineManager'

const persistence = vi.hoisted(() => ({
  readUserKeymapFile: vi.fn(),
  writeUserKeymapFile: vi.fn(),
}))
vi.mock('@src/registry/extensions/keymap/persistence', () => persistence)

beforeEach(() => {
  persistence.readUserKeymapFile.mockResolvedValue({
    version: KEYMAP_SCHEMA_VERSION,
    bindings: [],
  })
  persistence.writeUserKeymapFile.mockResolvedValue(undefined)
})

async function setup() {
  const targets = service<{
    attach: AttachCameraViewport
    shortcuts: ReadonlySignal<CameraShortcutHints>
  }>('test.camera-targets')
  const registry = new Registry()
  await registry.configure([
    provide(fileOperationsService, testFileOperations),
    provideWasmPromise(() => new Promise<ModuleType>(() => {})),
    machineManagerExtension,
    commandsExtension,
    keymapExtension,
    factory({
      dependencies: { camera: cameraCommands },
      create: ({ camera }) => ({ items: [provide(targets, camera)] }),
    }),
  ])
  onTestFinished(() => registry.dispose())
  return {
    registry,
    keymap: registry.required(keymapService),
    attach: registry.required(targets).attach,
    shortcuts: registry.required(targets).shortcuts,
  }
}

function scene(presentation: ScenePresentation) {
  const settings = createTestSettings()
  const camera = new CameraControls(
    document.createElement('canvas'),
    new ConnectionManager({ settingsActor: settings.actor }),
    () => settings.current.peek()
  )
  onTestFinished(() => camera.dispose())
  const axis = vi.spyOn(camera, 'updateCameraToAxis').mockResolvedValue()
  const fit = vi.spyOn(camera, 'zoomToFit').mockResolvedValue()
  const center = vi.spyOn(camera, 'centerOnSelection').mockResolvedValue()
  const reset = vi.fn(async () => {})
  const selection = createSceneSelection(
    {
      pick: async () => ({ reference: { type: 'face', face_id: 'face' } }),
      present: async () => {},
    },
    ['face']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  onTestFinished(selection.dispose)
  const resource = createTestKclScene(presentation, {
    selection,
    viewControls: {
      id: presentation,
      sceneInfra: { camControls: camera },
      theme: signal<Themes.Light | Themes.Dark>(Themes.Light),
      gizmoType: signal<'axis' | 'cube'>('cube'),
      reset,
      toggleGizmo: () => {},
    },
  })
  return { resource, axis, fit, center, reset }
}

function viewport() {
  const element = document.createElement('div')
  element.tabIndex = 0
  document.body.append(element)
  onTestFinished(() => element.remove())
  return element
}

function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    metaKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

it.each(['streamed', 'local'] as const)(
  'routes camera commands to the focused %s view and its replacement scene',
  async (presentation) => {
    const { attach, keymap, registry } = await setup()
    const first = scene(presentation)
    const second = scene(presentation)
    const replacement = scene(presentation)
    const firstElement = viewport(),
      secondElement = viewport()
    const current = signal(second.resource)
    const detachFirst = attach(firstElement, () => first.resource)
    const detachSecond = attach(secondElement, () => current.value)
    onTestFinished(detachFirst)
    onTestFinished(detachSecond)

    secondElement.focus()
    expect(keymap.getCurrentScopes()).toContain(MODELING_VIEW_FOCUSED_SCOPE)
    expect(press(secondElement, 'f').defaultPrevented).toBe(true)
    expect(second.fit).toHaveBeenCalledWith({ padding: 0.1 })
    expect(first.fit).not.toHaveBeenCalled()
    press(secondElement, 'x')
    expect(second.reset).toHaveBeenCalledOnce()

    current.value = replacement.resource
    press(secondElement, 'f')
    expect(replacement.fit).toHaveBeenCalledOnce()
    expect(second.fit).toHaveBeenCalledOnce()

    replacement.resource.runtime.executing.value = true
    press(secondElement, 'x')
    expect(replacement.reset).not.toHaveBeenCalled()
    replacement.resource.runtime.executing.value = false
    const center = registry
      .get(commandsFacet)
      .find((command) => command.id === 'kcl.camera.center')
    expect(center?.disabled).toBe(true)
    press(secondElement, 'c')
    expect(replacement.center).not.toHaveBeenCalled()
    await replacement.resource.selection.pick({ clientX: 1, clientY: 1 })
    expect(center?.disabled).toBe(false)
    press(secondElement, 'c')
    expect(replacement.center).toHaveBeenCalledOnce()

    firstElement.focus()
    press(firstElement, 'x')
    expect(first.reset).toHaveBeenCalledOnce()
    expect(replacement.reset).not.toHaveBeenCalled()
    detachFirst()
    expect(keymap.getCurrentScopes()).not.toContain(MODELING_VIEW_FOCUSED_SCOPE)
    press(firstElement, 'x')
    expect(first.reset).toHaveBeenCalledOnce()
  }
)

it('honors user remapping and leaves Code views and text fields alone', async () => {
  const { attach, keymap, shortcuts } = await setup()
  const view = scene('local')
  const element = viewport()
  const detach = attach(element, () => view.resource)
  onTestFinished(detach)
  await keymap.addUserBinding({
    command: 'kcl.camera.fit',
    keystrokes: ['mod+alt+q'],
    when: [MODELING_VIEW_FOCUSED_SCOPE],
  })
  element.focus()
  expect(shortcuts.value.fit).toEqual(['mod+alt+q'])
  press(element, 'f')
  expect(view.fit).not.toHaveBeenCalled()
  press(element, 'q')
  expect(view.fit).toHaveBeenCalledOnce()

  const input = document.createElement('input')
  element.append(input)
  input.focus()
  expect(keymap.getCurrentScopes()).not.toContain(MODELING_VIEW_FOCUSED_SCOPE)
  press(input, 'q')
  const code = viewport()
  code.classList.add('cm-content')
  code.focus()
  press(code, 'q')
  expect(view.fit).toHaveBeenCalledOnce()
})

it('keeps the palette launch target until submission and releases it afterward', async () => {
  const { registry, attach, keymap } = await setup()
  const view = scene('streamed')
  const element = viewport()
  const detach = attach(element, () => view.resource)
  onTestFinished(detach)
  element.focus()
  const commands = registry.required(commandSystemService)
  commands.send({ type: 'Open' })
  const paletteInput = document.createElement('input')
  document.body.append(paletteInput)
  onTestFinished(() => paletteInput.remove())
  paletteInput.focus()
  commands.send({
    type: 'Find and select command',
    data: { groupId: 'kcl.camera', name: 'kcl.camera.fit' },
  })
  expect(view.fit).toHaveBeenCalledOnce()
  expect(keymap.getCurrentScopes()).not.toContain(MODELING_VIEW_FOCUSED_SCOPE)
  press(paletteInput, 'f')
  expect(view.fit).toHaveBeenCalledOnce()
})

it('drops a closed viewport even while the command palette is open', async () => {
  const { registry, attach } = await setup()
  const view = scene('local')
  const element = viewport()
  const detach = attach(element, () => view.resource)
  element.focus()
  const commands = registry.required(commandSystemService)
  commands.send({ type: 'Open' })
  detach()
  commands.send({
    type: 'Find and select command',
    data: { groupId: 'kcl.camera', name: 'kcl.camera.reset' },
  })
  expect(view.reset).not.toHaveBeenCalled()
})

it.each(['streamed', 'local'] as const)(
  'applies standard-view sequences only to the focused %s camera',
  async (presentation) => {
    const { attach } = await setup()
    const first = scene(presentation),
      second = scene(presentation)
    const firstElement = viewport(),
      secondElement = viewport()
    onTestFinished(attach(firstElement, () => first.resource))
    onTestFinished(attach(secondElement, () => second.resource))
    secondElement.focus()
    const sequence = (element: HTMLElement, key: string) => {
      for (const character of ['v', key])
        element.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: character,
            bubbles: true,
            cancelable: true,
          })
        )
    }
    for (const [key, axis] of [
      ['1', 'z'],
      ['2', 'x'],
      ['3', '-y'],
      ['4', 'y'],
      ['5', '-z'],
      ['6', '-x'],
    ]) {
      sequence(secondElement, key)
      expect(second.axis).toHaveBeenLastCalledWith(axis)
    }
    expect(first.axis).not.toHaveBeenCalled()
    firstElement.focus()
    sequence(firstElement, '3')
    expect(first.axis).toHaveBeenCalledWith('-y')
    sequence(firstElement, 'f')
    expect(first.fit).toHaveBeenCalledOnce()
    sequence(firstElement, 'r')
    expect(first.reset).toHaveBeenCalledOnce()
  }
)
