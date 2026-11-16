import { createModelingTools } from '@src/lib/kcl/modelingTools'
import {
  Registry,
  defineRegistryItem,
  provideService,
  provide,
} from '@kittycad/registry'
import { commandsExtension } from '@src/registry/extensions/commands'
import {
  commandSystemService,
  contextualCommandsService,
} from '@src/registry/contracts/commands'
import { machineManagerService } from '@src/registry/contracts/machineManager'
import { wasmPromiseValueSpec } from '@src/registry/contracts/wasm'
import type { MachineManager } from '@src/lib/MachineManager'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

import {
  SKETCH_SOLVE_GROUP,
  RAYCASTABLE_PLANE,
} from '@src/clientSideScene/sceneUtils'
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  cleanup as cleanupReact,
} from '@testing-library/react'
import { KclScene } from '@src/lib/kcl/KclScene'
import { useApp, useSingletons } from '@src/lib/boot'
import { createScenePresentationPreferences } from '@src/lib/kcl/presentationPreferences'
import { createExecutorOutput } from '@src/lib/executors/output'
import type { ScenePresentation } from '@src/lib/kcl/scene/connection'
import type { WebSocketResponse } from '@kittycad/lib'
import { Vector2, Vector3, Sprite } from 'three'
import { Themes } from '@src/lib/theme'
import { SKETCH_SOLVE_ORIGIN_SPRITE } from '@src/machines/sketchSolve/originSprite'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { encode } from '@msgpack/msgpack'
import { signal } from '@preact/signals-core'
import { expect, it, vi } from 'vitest'
vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: vi.fn(),
  useSingletons: vi.fn(),
}))
import {
  buildTheWorldAndNoEngineConnection,
  createSettledUserFeaturesForTest,
} from '@src/unitTestUtils'
import { createKclRuntime } from '@src/lib/kcl/runtime'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createKclSceneSelection } from '@src/lib/kcl/sceneSelection'
import {
  openMachineModelingOwner,
  createMachineModelingHost,
} from '@src/lib/kcl/machine/host'
import { createKeymapTree } from '@src/registry/contracts/keymap'
import type { KclSceneResource } from '@src/lib/kcl/scene'

function commandEnvironment(wasm: ModuleType, manager: MachineManager) {
  const registry = new Registry()
  registry.configure([
    commandsExtension,
    defineRegistryItem({
      providesServices: [provideService(machineManagerService, { manager })],
      provides: [provide(wasmPromiseValueSpec, Promise.resolve(wasm))],
    }),
  ])
  return {
    commands: registry.get(commandSystemService),
    contextualCommands: registry.get(contextualCommandsService),
    dispose: () => registry[Symbol.dispose](),
  }
}

async function fixture(
  presentation: ScenePresentation = 'streamed',
  code = '@settings(kclVersion = 3.0)\nanswer = 42',
  sharedCommands?: ReturnType<typeof commandEnvironment>
) {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  const world = await buildTheWorldAndNoEngineConnection()
  // The harness's original manager lends the scene, not its sketch-owned objects.
  world.kclManager.sceneEntitiesManager.sketchSolveGroup.removeFromParent()
  world.kclManager.sceneEntitiesManager.intersectionPlane.removeFromParent()
  // The integration suite's WebGL mock omits clearing; retain real scene lifecycle/actions.
  world.sceneInfra.renderer.clear = vi.fn()
  world.sceneInfra.renderer.forceContextLoss = vi.fn()
  vi.spyOn(world.engineCommandManager, 'sendSceneCommand').mockImplementation(
    async (request) => {
      if (request.type === 'modeling_cmd_batch_req')
        return {
          success: true,
          request_id: request.batch_id,
          resp: {
            type: 'modeling_batch',
            data: {
              responses: Object.fromEntries(
                request.requests.map((item) => [
                  item.cmd_id,
                  { response: { type: item.cmd.type } },
                ])
              ),
            },
          },
        } as WebSocketResponse
      if (request.type === 'modeling_cmd_req')
        return {
          success: true,
          request_id: request.cmd_id,
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: request.cmd.type, data: {} } },
          },
        } as WebSocketResponse
      return null
    }
  )
  const view = modelingTestContext(presentation)
  // These host regressions cover legacy dialogs; modelingDialog.spec.tsx covers contributed Form/Code dialogs.
  view.context.tools.dispose()
  const tools = createModelingTools(() => view.context, signal([]))
  view.context.tools = tools
  view.editor.dispatch({
    changes: { from: 0, to: view.editor.state.doc.length, insert: code },
  })
  view.context.executor = {
    ...view.context.executor,
    output: signal(
      createExecutorOutput({ contents: code, src: '/main.kcl', running: false })
    ),
  }
  const preferences = createScenePresentationPreferences(
    () => view.context.settings.current.value
  )
  if (presentation === 'local')
    vi.spyOn(world.engineCommandManager, 'geometryOnly', 'get').mockReturnValue(
      true
    )
  const native = await createKclRuntime(
    Promise.resolve(world.instance),
    {
      engineSessionId: undefined,
      startNewSession: async () => {},
      trackExecution: () => () => {},
      waitForAllModelingCommands: async () => [],
      fireModelingCommandFromWasm: () => undefined,
      sendModelingCommandFromWasm: async (
        id: string,
        _range: string,
        json: string
      ) => {
        const command = JSON.parse(json)
        if (command.type === 'modeling_cmd_batch_req')
          return encode({
            success: true,
            request_id: id,
            resp: {
              type: 'modeling_batch',
              data: {
                responses: Object.fromEntries(
                  command.requests.map((request: { cmd_id: string }) => [
                    request.cmd_id,
                    { response: { type: 'empty' } },
                  ])
                ),
              },
            },
          })
        return encode({
          success: true,
          request_id: id,
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: 'empty' } },
          },
        })
      },
    },
    () => ({})
  )
  await native.execute({
    src: '/main.kcl',
    files: new Map([
      [
        '/main.kcl',
        new TextEncoder().encode(view.context.executor.editor.contents.peek()),
      ],
    ]),
  })
  const picking = createKclSceneSelection(
    world.engineCommandManager,
    world.sceneInfra,
    native,
    presentation
  )
  picking.selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  const scene: KclSceneResource = {
    ...view.resource,
    sceneInfra: world.sceneInfra,
    runtime: native,
    localHost: undefined,
    selection: picking.selection,
    machineInput: {
      manager: world.engineCommandManager,
      handoffPicking: picking.handoff,
    },
    resize: async () => {},
    frameModel: async () => {},
    isConnected: () => true,
    resume: () => {},
    applySettings: async () => {},
    dispose: async () => {},
    commands: world.engineCommandManager,
    preferences,
  }
  view.context.session.resource.value = scene
  // Keep the real settings actor used by SceneInfra and the borrowed native adapter.
  view.context.settings.actor = world.settingsActor
  view.context.wasm = Promise.resolve(world.instance)
  const invalidated = vi.fn(async () => {})
  const commandEnv =
    sharedCommands ?? commandEnvironment(world.instance, world.machineManager)
  const deps = {
    commands: commandEnv.commands,
    contextualCommands: commandEnv.contextualCommands,
    keymapTree: signal(createKeymapTree([])),
    keymapScopes: signal([]),
    fileOperations: world.kclManager.systemDeps.fileOperations,
    kclExecutionSettings: world.kclManager.systemDeps.kclExecutionSettings,
    userFeatures: { ...createSettledUserFeaturesForTest(), has: () => false },
    machineManager: world.machineManager,
    project: signal(undefined),
    projectPath: signal(''),
  }
  const result = await openMachineModelingOwner(
    view.context,
    scene,
    deps,
    invalidated
  )
  if (result instanceof Error) throw result
  return {
    owner: result,
    deps,
    native,
    view,
    scene,
    picking,
    invalidated,
    commandEnv,
    dispose: async () => {
      await result.dispose()
      tools.dispose()
      if (!sharedCommands) commandEnv.dispose()
      picking.dispose()
      await native.dispose()
      preferences.dispose()
      view.dispose()
      world.kclManager.close()
      world.sceneInfra.dispose()
      world.rustContext.destroy()
      world.commandBarActor.stop()
      world.settingsActor.stop()
    },
  }
}

it('starts the real machine with a borrowed scene and shared document, and releases picking on close', async () => {
  const first = await fixture(),
    second = await fixture()
  try {
    expect(first.owner.model.sceneInfra).toBe(first.scene.sceneInfra)
    expect(first.owner.state.peek().matches('idle')).toBe(true)
    expect(first.scene.selection.pickingEnabled.peek()).toBe(true)
    first.owner.actor.send({
      type: 'Set selection',
      data: {
        selectionType: 'enginePrimitiveSelection',
        selection: {
          type: 'enginePrimitive',
          entityId: 'native-edge',
          primitiveIndex: 0,
          primitiveType: 'edge',
        },
      },
    })
    expect(first.owner.selection.items.peek()).toEqual([
      expect.objectContaining({
        kind: 'engine-primitive',
        selection: expect.objectContaining({ entityId: 'native-edge' }),
      }),
    ])
    expect(second.owner.selection.items.peek()).toEqual([])
    first.owner.selection.clear()
    expect(first.owner.selection.items.peek()).toEqual([])
    const dialog = first.scene.selection.beginPicking({ arguments: [] })
    if (dialog instanceof Error) throw dialog
    first.scene.sceneInfra.modelingSend({ type: 'Enter sketch' })
    expect(first.owner.state.peek().matches('idle')).toBe(true)
    dialog.close()
    first.owner.actor.send({ type: 'Enter sketch' })
    expect(first.owner.state.peek().matches('Sketch no face')).toBe(true)
    expect(second.owner.state.peek().matches('idle')).toBe(true)
    first.owner.actor.send({ type: 'Cancel' })
    expect(first.owner.state.peek().matches('idle')).toBe(true)
    first.owner.model.updateCodeEditor(
      '@settings(kclVersion = 3.0)\nanswer = 84',
      { shouldWriteToDisk: false, shouldSyncRust: false }
    )
    expect(first.view.context.executor.editor.contents.peek()).toContain(
      'answer = 84'
    )
    expect(second.view.context.executor.editor.contents.peek()).toContain(
      'answer = 42'
    )
    expect(first.invalidated).not.toHaveBeenCalled()
    first.owner.model.undo()
    expect(first.view.context.executor.editor.contents.peek()).toContain(
      'answer = 42'
    )
    await first.owner.dispose()
    expect(first.scene.selection.pickingEnabled.peek()).toBe(true)
    first.owner.model.updateCodeEditor('stale callback')
    expect(first.view.context.executor.editor.contents.peek()).toContain(
      'answer = 42'
    )
  } finally {
    await first.dispose()
    await second.dispose()
  }
})

it.each(['streamed', 'local'] as const)(
  'uses the legacy Circle child with undoable native edits in %s presentation',
  async (presentation) => {
    const unit = presentation === 'local' ? 'in' : 'mm'
    const view = await fixture(
      presentation,
      `@settings(kclVersion = 3.0, defaultLengthUnit = ${unit})\nanswer = 42`
    )
    try {
      const { owner } = view
      owner.actor.send({ type: 'Enter sketch' })
      const plane = owner.rust.defaultPlanes?.xy
      expect(plane).toBeDefined()
      owner.actor.send({ type: 'Select sketch solve plane', data: plane! })
      await vi.waitFor(
        () => expect(owner.state.peek().matches('sketchSolveMode')).toBe(true),
        { timeout: 10000 }
      )
      const before = view.view.context.executor.editor.contents.peek()
      const attached = vi.spyOn(owner.scene.sceneInfra, 'setCallbacks')
      owner.actor.send({ type: 'equip tool', data: { tool: 'circleTool' } })
      for (const x of [10, 20]) {
        const click = attached.mock.lastCall?.[0].onClick
        expect(click).toBeDefined()
        const mouseEvent = new MouseEvent('click', {
          button: 0,
          shiftKey: true,
        })
        Object.defineProperty(mouseEvent, 'which', { value: 1 })
        await click!({
          wasmInstance: owner.state.peek().context.wasmInstance,
          mouseEvent,
          intersectionPoint: {
            twoD: new Vector2(x, 10),
            threeD: new Vector3(x, 10, 0),
          },
          intersects: [],
        })
        await vi.waitFor(() => {
          expect(
            owner.child.peek()?.context.childTool?.getSnapshot().value
          ).toBe(x === 10 ? 'Showing radius preview' : 'ready for center click')
        })
      }
      await vi.waitFor(() =>
        expect(view.view.context.executor.editor.contents.peek()).toContain(
          'circle('
        )
      )
      expect(view.view.editor.contents.peek()).toContain(`var 10${unit}`)
      owner.model.undo()
      await vi.waitFor(() =>
        expect(view.view.context.executor.editor.contents.peek()).toBe(before)
      )
      owner.model.redo()
      await vi.waitFor(() =>
        expect(view.view.context.executor.editor.contents.peek()).toContain(
          'circle('
        )
      )
      await owner.dispose()
      expect(view.view.editor.undo()).toBe(true)
      expect(view.view.editor.contents.peek()).toBe(before)
      expect(view.view.editor.redo()).toBe(true)
      expect(view.view.editor.contents.peek()).toContain('circle(')
    } finally {
      await view.dispose()
    }
  }
)

it('retires the old machine before external re-execution and creates a new owner without touching a sibling view', async () => {
  const first = await fixture(),
    second = await fixture()
  await first.owner.dispose()
  const host = createMachineModelingHost(() => first.view.context, first.deps)
  try {
    await vi.waitFor(() => expect(host.owner.peek()).toBeDefined())
    const old = host.owner.peek()!
    const code = '@settings(kclVersion = 3.0)\nanswer = 84'
    first.view.editor.dispatch({
      changes: {
        from: 0,
        to: first.view.editor.state.doc.length,
        insert: code,
      },
    })
    await first.native.execute({
      src: '/main.kcl',
      files: new Map([['/main.kcl', new TextEncoder().encode(code)]]),
    })
    await vi.waitFor(() => {
      expect(host.owner.peek()).toBeDefined()
      expect(host.owner.peek()).not.toBe(old)
    })
    expect(old.actor.getSnapshot().status).toBe('stopped')
    expect(host.owner.peek()!.model.code).toBe(code)
    old.model.updateCodeEditor('late old edit')
    expect(first.view.editor.contents.peek()).toBe(code)
    expect(second.owner.actor.getSnapshot().status).toBe('active')
    expect(second.view.editor.contents.peek()).toContain('answer = 42')
  } finally {
    await host.dispose()
    await first.dispose()
    await second.dispose()
  }
})

it('renders the machine-backed Modeling view and cancels plane picking without looking up global owners', async () => {
  const view = await fixture()
  await view.owner.dispose()
  const host = createMachineModelingHost(() => view.view.context, view.deps)
  view.view.context.machine = host
  try {
    await vi.waitFor(() => expect(host.owner.peek()).toBeDefined())
    vi.mocked(useApp).mockClear()
    vi.mocked(useSingletons).mockClear()
    render(<KclScene context={view.view.context} />)
    const toolbar = await screen.findByRole('toolbar', {
      name: 'Modeling tools',
    })
    const picking = view.scene.selection.beginPicking({ arguments: [] })
    if (picking instanceof Error) throw picking
    await act(async () => {
      view.scene.sceneInfra.modelingSend({ type: 'Enter sketch' })
    })
    expect(host.owner.peek()?.state.peek().matches('idle')).toBe(true)
    picking.close()
    fireEvent.click(
      within(toolbar).getByRole('button', { name: /Start Sketch/i })
    )
    await screen.findByText('Select a plane or face to start sketching.')
    await act(async () => {
      fireEvent.keyDown(view.scene.sceneInfra.renderer.domElement, {
        key: 'Escape',
        bubbles: true,
      })
    })
    expect(
      within(toolbar).getByRole('button', { name: /Start Sketch/i })
    ).toBeInTheDocument()
    expect(useApp).not.toHaveBeenCalled()
    expect(useSingletons).not.toHaveBeenCalled()
  } finally {
    cleanupReact()
    await host.dispose()
    await view.dispose()
  }
})

it('refreshes existing sketch origin colors when the scene theme changes without executing again', async () => {
  const view = await fixture('local')
  try {
    view.scene.sceneInfra.theme = Themes.Light
    view.owner.actor.send({ type: 'Enter sketch' })
    view.owner.actor.send({
      type: 'Select sketch solve plane',
      data: view.owner.rust.defaultPlanes!.xy,
    })
    await vi.waitFor(() =>
      expect(view.owner.state.peek().matches('sketchSolveMode')).toBe(true)
    )
    const origin =
      view.owner.model.sceneEntitiesManager.sketchSolveGroup.getObjectByName(
        SKETCH_SOLVE_ORIGIN_SPRITE
      )
    if (!(origin instanceof Sprite))
      throw new Error('Expected sketch origin sprite')
    const darkViewportTexture = origin.material.map
    const execute = vi.spyOn(view.owner.model, 'executeCode')
    view.scene.sceneInfra.theme = Themes.Dark
    expect(origin.material.map).not.toBe(darkViewportTexture)
    expect(execute).not.toHaveBeenCalled()
    view.scene.sceneInfra.theme = Themes.Light
    expect(origin.material.map).toBe(darkViewportTexture)
    expect(view.owner.state.peek().matches('sketchSolveMode')).toBe(true)
  } finally {
    await view.dispose()
  }
})

it('opens modeling dialogs from the toolbar, hotkey, and shared command catalogue', async () => {
  const view = await fixture('local')
  view.view.context.machine = {
    owner: signal(view.owner),
    error: signal(undefined),
  }
  view.deps.keymapTree.value = createKeymapTree([
    {
      id: 'extrude',
      title: 'Extrude',
      source: 'test',
      when: ['mode-modeling'],
      keystrokes: ['e'],
      command: 'modeling:Extrude',
    },
  ])
  try {
    render(<KclScene context={view.view.context} />)
    const toolbar = await screen.findByRole('toolbar', {
      name: 'Modeling tools',
    })
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Extrude/ }))
    await screen.findByRole('region', { name: 'Extrude' })
    const shared = view.commandEnv.commands.actor
    expect(shared.getSnapshot().context.selectedCommand?.machineActor).toBe(
      view.owner.actor
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() =>
      expect(shared.getSnapshot().matches('Closed')).toBe(true)
    )
    fireEvent.keyDown(view.scene.element, { key: 'e', bubbles: true })
    await screen.findByRole('region', { name: 'Extrude' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() =>
      expect(shared.getSnapshot().matches('Closed')).toBe(true)
    )
    expect(
      shared
        .getSnapshot()
        .context.commands.some(
          (command) => command.groupId === 'modeling' && command.name === 'Loft'
        )
    ).toBe(true)
    await act(async () =>
      view.commandEnv.commands.send({
        type: 'Find and select command',
        data: { name: 'Loft', groupId: 'modeling' },
      })
    )
    await screen.findByRole('region', { name: 'Loft' })
    expect(shared.getSnapshot().context.selectedCommand?.machineActor).toBe(
      view.owner.actor
    )
  } finally {
    cleanupReact()
    await view.dispose()
  }
})

it.each(['streamed', 'local'] as const)(
  'adds and toggles dialog picks with Shift, then replaces after release in %s',
  async (presentation) => {
    const view = await fixture(
      presentation,
      `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  circle(center = [0, 0], start = [10, 0])
  circle(center = [30, 0], start = [40, 0])
}`
    )
    view.view.context.machine = {
      owner: signal(view.owner),
      error: signal(undefined),
    }
    try {
      const segments = [...view.owner.model.artifactGraph.values()].filter(
        (artifact) => artifact.type === 'segment'
      )
      expect(segments).toHaveLength(2)
      render(<KclScene context={view.view.context} />)
      const toolbar = await screen.findByRole('toolbar', {
        name: 'Modeling tools',
      })
      await act(async () => {
        fireEvent.click(
          within(toolbar).getByRole('button', { name: /^Extrude/ })
        )
      })
      const profiles = await screen.findByRole('group', {
        name: 'Profiles selections',
      })
      const pick = async (index: number) => {
        const segment = segments[index]
        await act(async () => {
          for (const callback of Object.values(
            view.scene.machineInput.manager.subscriptions
              .query_entity_type_with_point
          )) {
            callback({
              type: 'query_entity_type_with_point',
              data: {
                reference: {
                  type: 'segment',
                  segment_id: segment.id,
                  path_id: segment.pathId,
                },
              },
            })
          }
        })
      }
      await pick(0)
      await vi.waitFor(() =>
        expect(
          view.owner.state.peek().context.selectionRanges.graphSelections
        ).toHaveLength(1)
      )
      fireEvent.keyDown(window, { key: 'Shift', shiftKey: true })
      await pick(1)
      await vi.waitFor(() =>
        expect(
          view.owner.state.peek().context.selectionRanges.graphSelections
        ).toHaveLength(2)
      )
      expect(
        within(profiles).getAllByRole('button', { name: /Remove/ })
      ).toHaveLength(2)
      await pick(0)
      await vi.waitFor(() =>
        expect(
          view.owner.state.peek().context.selectionRanges.graphSelections
        ).toHaveLength(1)
      )
      fireEvent.keyUp(window, { key: 'Shift' })
      await pick(0)
      await vi.waitFor(() =>
        expect(
          view.owner.state
            .peek()
            .context.selectionRanges.graphSelections.map(
              (selection) => selection.entityRef
            )
        ).toEqual([
          {
            type: 'segment',
            segment_id: segments[0].id,
            path_id: segments[0].pathId,
          },
        ])
      )
      expect(
        within(profiles).getAllByRole('button', { name: /Remove/ })
      ).toHaveLength(1)
    } finally {
      fireEvent.keyUp(window, { key: 'Shift' })
      cleanupReact()
      await view.dispose()
    }
  }
)

it('keeps an open command bound to its original view when another view becomes active or closes', async () => {
  const first = await fixture()
  const second = await fixture('local', undefined, first.commandEnv)
  try {
    expect(second.owner.commands.actor).toBe(first.owner.commands.actor)
    first.owner.commandSource.activate()
    first.owner.commands.send({
      type: 'Find and select command',
      data: { name: 'Extrude', groupId: 'modeling' },
    })
    const shared = first.owner.commands.actor
    expect(shared.getSnapshot().context.selectedCommand?.machineActor).toBe(
      first.owner.actor
    )
    second.owner.commandSource.activate()
    expect(shared.getSnapshot().context.selectedCommand?.machineActor).toBe(
      first.owner.actor
    )
    await second.owner.dispose()
    expect(shared.getSnapshot().context.selectedCommand?.machineActor).toBe(
      first.owner.actor
    )
    expect(shared.getSnapshot().matches('Closed')).toBe(false)
    await first.owner.dispose()
    expect(shared.getSnapshot().matches('Closed')).toBe(true)
    expect(shared.getSnapshot().status).toBe('active')
  } finally {
    await second.dispose()
    await first.dispose()
  }
})

it.each(['streamed', 'local'] as const)(
  'double-clicks existing sketch geometry through the machine canvas in %s',
  async (presentation) => {
    const view = await fixture(
      presentation,
      `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  circle(center = [0, 0], start = [10, 0])
}`
    )
    try {
      const segment = [...view.owner.model.artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      expect(segment?.type).toBe('segment')
      if (!segment || segment.type !== 'segment')
        throw new Error('Expected native sketch segment')
      const send = vi.spyOn(view.scene.machineInput.manager, 'sendSceneCommand')
      const ordinaryCommand = send.getMockImplementation()!
      const picked = {
        success: true,
        resp: {
          type: 'modeling',
          data: {
            modeling_response: {
              type: 'query_entity_type_with_point',
              data: {
                reference: {
                  type: 'segment',
                  segment_id: segment.id,
                  path_id: segment.pathId,
                },
              },
            },
          },
        },
      } as WebSocketResponse
      send.mockImplementation((request) =>
        request.type === 'modeling_cmd_req' &&
        request.cmd.type === 'query_entity_type_with_point'
          ? Promise.resolve(picked)
          : ordinaryCommand(request)
      )
      vi.spyOn(
        view.scene.sceneInfra.renderer.domElement,
        'getBoundingClientRect'
      ).mockReturnValue(new DOMRect(0, 0, 640, 360))
      const mouseEvent = new MouseEvent('mouseup', {
        button: 0,
        detail: 2,
        clientX: 100,
        clientY: 100,
      })
      Object.defineProperty(mouseEvent, 'which', { value: 1 })
      await view.scene.sceneInfra.onClickCallback({
        mouseEvent,
        wasmInstance: view.owner.state.peek().context.wasmInstance,
        intersects: [],
      })
      await vi.waitFor(() =>
        expect(view.owner.state.peek().matches('sketchSolveMode')).toBe(true)
      )
    } finally {
      await view.dispose()
    }
  }
)

it.each(['streamed', 'local'] as const)(
  'replaces retired sketch graphics before orienting a new sketch plane in %s',
  async (presentation) => {
    const view = await fixture(presentation)
    let replacement: typeof view.owner | undefined
    try {
      view.owner.actor.send({ type: 'Enter sketch' })
      view.owner.actor.send({
        type: 'Select sketch solve plane',
        data: view.owner.rust.defaultPlanes!.xy,
      })
      await vi.waitFor(() =>
        expect(view.owner.state.peek().matches('sketchSolveMode')).toBe(true)
      )
      const oldEntities = view.owner.model.sceneEntitiesManager
      const oldCamera = vi.spyOn(oldEntities, 'onCamChange')
      view.owner.actor.send({ type: 'Exit sketch' })
      await vi.waitFor(() =>
        expect(view.owner.state.peek().matches('idle')).toBe(true)
      )
      await view.owner.dispose()
      expect(
        view.scene.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      ).toBeUndefined()
      expect(
        view.scene.sceneInfra.scene.getObjectByName(RAYCASTABLE_PLANE)
      ).toBeUndefined()
      const code = view.view.editor.contents.peek()
      await view.native.execute({
        src: '/main.kcl',
        files: new Map([['/main.kcl', new TextEncoder().encode(code)]]),
      })
      const next = await openMachineModelingOwner(
        view.view.context,
        view.scene,
        view.deps,
        view.invalidated
      )
      if (next instanceof Error) throw next
      replacement = next
      next.actor.send({ type: 'Enter sketch' })
      next.actor.send({
        type: 'Select sketch solve plane',
        data: next.rust.defaultPlanes!.yz,
      })
      await vi.waitFor(() =>
        expect(next.state.peek().matches('sketchSolveMode')).toBe(true)
      )
      const rendered =
        view.scene.sceneInfra.scene.getObjectByName(SKETCH_SOLVE_GROUP)
      expect(rendered).toBe(next.model.sceneEntitiesManager.sketchSolveGroup)
      expect(rendered!.children.length).toBeGreaterThan(0)
      const normal = new Vector3(0, 0, 1).applyQuaternion(rendered!.quaternion)
      expect(Math.abs(normal.x)).toBeCloseTo(1)
      expect(normal.y).toBeCloseTo(0)
      expect(normal.z).toBeCloseTo(0)
      oldCamera.mockClear()
      view.scene.sceneInfra.camControls.cameraChange.dispatch()
      view.scene.sceneInfra.baseUnitChange.dispatch()
      expect(oldCamera).not.toHaveBeenCalled()
    } finally {
      await replacement?.dispose()
      await view.dispose()
    }
  }
)

it('does not deliver a delayed double-click to a replacement machine owner', async () => {
  const view = await fixture(
    'streamed',
    `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  circle(center = [0, 0], start = [10, 0])
}`
  )
  let replacement: typeof view.owner | undefined
  const response = Promise.withResolvers<WebSocketResponse>()
  try {
    const segment = [...view.owner.model.artifactGraph.values()].find(
      (artifact) => artifact.type === 'segment'
    )
    if (!segment || segment.type !== 'segment')
      throw new Error('Expected native sketch segment')
    const send = vi.spyOn(view.scene.machineInput.manager, 'sendSceneCommand')
    const ordinary = send.getMockImplementation()!
    const queried = vi.fn()
    send.mockImplementation((request) => {
      if (
        request.type === 'modeling_cmd_req' &&
        request.cmd.type === 'query_entity_type_with_point'
      ) {
        queried()
        return response.promise
      }
      return ordinary(request)
    })
    vi.spyOn(
      view.scene.sceneInfra.renderer.domElement,
      'getBoundingClientRect'
    ).mockReturnValue(new DOMRect(0, 0, 640, 360))
    const mouseEvent = new MouseEvent('mouseup', { button: 0, detail: 2 })
    Object.defineProperty(mouseEvent, 'which', { value: 1 })
    const activation = view.scene.sceneInfra.onClickCallback({
      mouseEvent,
      wasmInstance: view.owner.state.peek().context.wasmInstance,
      intersects: [],
    })
    await vi.waitFor(() => expect(queried).toHaveBeenCalledOnce())
    await view.owner.dispose()
    const next = await openMachineModelingOwner(
      view.view.context,
      view.scene,
      view.deps,
      view.invalidated
    )
    if (next instanceof Error) throw next
    replacement = next
    response.resolve({
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: {
            type: 'query_entity_type_with_point',
            data: {
              reference: {
                type: 'segment',
                segment_id: segment.id,
                path_id: segment.pathId,
              },
            },
          },
        },
      },
    })
    await activation
    expect(next.state.peek().matches('idle')).toBe(true)
    expect(next.child.peek()).toBeUndefined()
  } finally {
    response.resolve({ success: false, errors: [] })
    await replacement?.dispose()
    await view.dispose()
  }
})
