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
import { Vector2, Vector3 } from 'three'
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

async function fixture(
  presentation: ScenePresentation = 'streamed',
  code = '@settings(kclVersion = 3.0)\nanswer = 42'
) {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  const world = await buildTheWorldAndNoEngineConnection()
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
  const deps = {
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
    dispose: async () => {
      await result.dispose()
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
