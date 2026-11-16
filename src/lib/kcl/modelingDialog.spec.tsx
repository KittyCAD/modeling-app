import { createActor } from 'xstate'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { MachineManager } from '@src/lib/MachineManager'
import { toolCommand } from '@src/lib/kcl/stdlibTools'
import { bindMachineDialogs } from '@src/lib/kcl/machine/dialogs'
import type { Transaction } from '@codemirror/state'
import '@src/lib/projectSession/next/testFeature'
import { signal } from '@preact/signals-core'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { assertParse, execStateFromRust, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createExecutorOutput } from '@src/lib/executors/output'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createModelingDialog } from '@src/lib/kcl/modelingDialog'
import { extrudeTool, loftTool } from '@src/lib/kcl/stdlibTools'
import { defineStdlibModelingTool } from '@src/lib/kcl/toolDefinitions'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import ModelingToolDialogView from '@src/lib/kcl/ModelingToolDialog'
vi.mock('@src/clientSideScene/localRenderer/LocalWebGPUScene', () => ({
  LocalWebGPUSceneView: () => null,
}))
let wasm: ModuleType
const cleanup: (() => void)[] = []
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})
const configuration = JSON.stringify({
  settings: { modeling: { base_unit: 'mm' } },
})
const source = `@settings(kclVersion = 3.0, defaultLengthUnit = mm)
height = 12mm
// Keep this sketch and its cursor position.
lower = sketch(on = XY) {
  c = circle(start = [10mm, 0mm], center = [0mm, 0mm])
  radius(c) == 10mm
}
upper = sketch(on = offsetPlane(XY, offset = 20mm)) {
  c = circle(start = [5mm, 0mm], center = [0mm, 0mm])
  radius(c) == 5mm
}
`
function requireValue<T>(value: T | Error): T {
  if (value instanceof Error) throw value
  return value
}
async function fixture() {
  const view = modelingTestContext()
  cleanup.push(view.dispose)
  const contents = requireValue(recast(assertParse(source, wasm), wasm))
  view.editor.dispatch({
    changes: {
      from: 0,
      to: view.editor.contents.peek().length,
      insert: contents,
    },
  })
  view.context.wasm = Promise.resolve(wasm)
  view.context.executor = {
    ...view.context.executor,
    output: signal(
      createExecutorOutput({ contents, src: '/main.kcl', running: false })
    ),
  }
  const native = new wasm.Context(
    {
      sendModelingCommandFromWasm: () =>
        Promise.reject(new Error('Mock execution must not use the engine')),
      fireModelingCommandFromWasm: () => undefined,
      startNewSession: async () => {},
    },
    {
      readFile: async () => new TextEncoder().encode(contents),
      exists: async () => true,
      getAllFiles: async () => JSON.stringify(['/main.kcl']),
    }
  )
  cleanup.push(() => native.free())
  const ast = assertParse(contents, wasm)
  const state = execStateFromRust(
    await native.executeMock(
      JSON.stringify(ast),
      '/main.kcl',
      configuration,
      false
    )
  )
  view.resource.runtime.ast.value = ast
  view.resource.runtime.state.value = state
  view.resource.runtime.evaluateExpression.mockImplementation(
    async (expression) =>
      execStateFromRust(
        await native.executeMock(
          JSON.stringify({ ...ast, body: [...ast.body, ...expression.body] }),
          '/main.kcl',
          configuration,
          false
        )
      )
  )
  view.resource.runtime.validate.mockImplementation(async (ast) => {
    try {
      await native.executeMock(
        JSON.stringify(ast),
        '/main.kcl',
        configuration,
        false
      )
      return undefined
    } catch (cause) {
      return cause instanceof Error ? cause : new Error(JSON.stringify(cause))
    }
  })
  const paths = [...state.artifactGraph.values()].filter(
    (artifact) => artifact.type === 'path'
  )
  expect(paths.length).toBeGreaterThanOrEqual(2)
  view.resource.commands.sendSceneCommand.mockImplementation(async (raw) => {
    const request = raw as EngineCommand
    if (request.type !== 'modeling_cmd_req') return null
    const cmd = request.cmd
    const data =
      cmd.type === 'region_get_query_point'
        ? { query_point: { x: 0, y: 0 } }
        : cmd.type === 'entity_get_parent_id'
          ? { entity_id: paths[Number(cmd.entity_id)].id }
          : {}
    return {
      success: true,
      request_id: request.cmd_id,
      resp: {
        type: 'modeling',
        data: { modeling_response: { type: cmd.type, data } },
      },
    }
  })
  const pick = (id: number, additive = false) =>
    view.resource.selection.pick({ clientX: id, clientY: 0 }, additive)
  const open = async (tool: 'Extrude' | 'Loft') => {
    const dialog =
      tool === 'Extrude'
        ? requireValue(
            await createModelingDialog(
              view.context,
              extrudeTool,
              false,
              () => {}
            )
          )
        : requireValue(
            await createModelingDialog(view.context, loftTool, false, () => {})
          )
    cleanup.push(dialog.cancel)
    return dialog
  }
  return { ...view, contents, pick, open }
}

it.each(['Extrude', 'Loft'] as const)(
  'submits %s from dialog-owned regions as one undoable source edit',
  async (name) => {
    const view = await fixture()
    await view.pick(0)
    const original = view.resource.selection.selected.peek()
    const dialog = await view.open(name)
    expect(dialog.values.peek()).toMatchObject({
      sketches: {
        graphSelections: [{ entityRef: { type: 'region', region_id: '0' } }],
      },
    })
    if (name === 'Loft') {
      dialog.activate('sketches')
      await view.pick(1, true)
    } else dialog.save('length', 'height')
    expect(view.resource.selection.selected.peek()).toBe(original)
    const transactions: Transaction[] = []
    cleanup.push(
      view.editor.subscribe((transaction) => {
        if (transaction.docChanged) transactions.push(transaction)
      })
    )
    const anchor = view.contents.indexOf('radius(c)')
    await dialog.submit()
    expect(dialog.error.peek()).toBeUndefined()
    const code = view.editor.contents.peek()
    expect(transactions).toHaveLength(1)
    const mappedAnchor = transactions[0].changes.mapPos(anchor)
    expect(code.slice(mappedAnchor, mappedAnchor + 'radius(c)'.length)).toBe(
      'radius(c)'
    )
    expect(code).toContain(name.toLowerCase() + '(')
    expect(code).toContain('region(')
    if (name === 'Extrude') expect(code).toContain('length = height')
    expect(view.editor.undo()).toBe(true)
    expect(view.editor.contents.peek()).toBe(view.contents)
  }
)

it('keeps picking in the dialog and leaves view selection unchanged when cancelled', async () => {
  const view = await fixture()
  await view.pick(0)
  const original = view.resource.selection.selected.peek()
  const dialog = await view.open('Extrude')
  await view.pick(1)
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [{ entityRef: { region_id: '0' } }] },
  })
  dialog.activate('sketches')
  await view.pick(1)
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [{ entityRef: { region_id: '1' } }] },
  })
  dialog.activate(undefined)
  await view.pick(0)
  expect(view.resource.selection.selected.peek()).toBe(original)
  dialog.cancel()
  expect(view.resource.selection.displayed.peek()).toEqual(original)
  expect(view.editor.contents.peek()).toBe(view.contents)
})

it('invalidates picks on re-execution and only binds the new model when an argument is explicitly selected', async () => {
  const view = await fixture()
  await view.pick(0)
  const dialog = await view.open('Extrude')
  view.resource.selection.invalidate()
  view.resource.selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  expect(dialog.invalidated.peek()).toBe(true)
  await dialog.submit()
  expect(dialog.error.peek()).toBeInstanceOf(Error)
  expect(view.editor.contents.peek()).toBe(view.contents)
  expect(dialog.activate('sketches')).toBeUndefined()
  expect(dialog.invalidated.peek()).toBe(false)
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [], otherSelections: [] },
  })
  await view.pick(0)
  await dialog.submit()
  expect(dialog.error.peek()).toBeUndefined()
  expect(view.editor.contents.peek()).toContain('extrude(')
})

it.each([
  'source edit',
  'picks changed',
  'read-only',
  'cancel',
  're-execution',
] as const)(
  'rejects an operation when %s happens during review',
  async (change) => {
    const view = await fixture()
    await view.pick(0)
    const dialog = await view.open('Extrude')
    const review = Promise.withResolvers<Error | undefined>()
    view.resource.runtime.validate.mockImplementation(() => review.promise)
    const pending = dialog.submit()
    await vi.waitFor(() =>
      expect(view.resource.runtime.validate).toHaveBeenCalled()
    )
    if (change === 'source edit')
      view.editor.dispatch({ changes: { from: 0, insert: '// Changed\n' } })
    if (change === 'picks changed') {
      dialog.activate('sketches')
      await view.pick(1)
    }
    if (change === 'read-only') view.editor.readOnly.value = true
    if (change === 'cancel') dialog.cancel()
    if (change === 're-execution') view.resource.selection.invalidate()
    const before = view.editor.contents.peek()
    review.resolve(undefined)
    await pending
    expect(view.editor.contents.peek()).toBe(before)
    if (change !== 'cancel') expect(dialog.error.peek()).toBeInstanceOf(Error)
  }
)

it('shares scalar edits and undo between Form and Code, and rejects forged selection metadata', async () => {
  const view = await fixture()
  const dialog = await view.open('Extrude')
  await act(async () => {
    render(<ModelingToolDialogView dialog={dialog} />)
  })
  await screen.findByRole(
    'button',
    { name: 'Select Profiles' },
    { timeout: 10000 }
  )
  await act(async () => {
    dialog.save('length', 'height')
  })
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Argument mode' }), {
      target: { value: 'editors.code' },
    })
  })
  await vi.waitFor(() =>
    expect(dialog.editors.viewState(dialog.instance).peek().selected?.id).toBe(
      'editors.code'
    )
  )
  expect(dialog.editor.contents.peek()).toContain('height')
  await act(async () => {
    const code = dialog.instance.codeView.peek()
    if (!code) throw new Error('Code mode did not mount')
    code.dispatch({
      changes: {
        from: 0,
        to: code.state.doc.length,
        insert: '{"length":"6mm"}',
      },
      userEvent: 'input.type',
    })
  })
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Argument mode' }), {
      target: { value: 'modeling-arguments.form' },
    })
  })
  await screen.findByRole(
    'button',
    { name: 'Select Profiles' },
    { timeout: 10000 }
  )
  expect(dialog.values.peek()).toMatchObject({ length: '6mm' })
  await act(async () => {
    dialog.editor.undo()
  })
  expect(dialog.values.peek()).toMatchObject({ length: 'height' })
  await act(async () => {
    dialog.editor.dispatch({
      changes: {
        from: 0,
        to: dialog.editor.contents.peek().length,
        insert: '{"sketches":{"graphSelections":[]}}',
      },
    })
  })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Selection arguments must contain an array of picked entity references.'
  )
  await dialog.submit()
  expect(view.editor.contents.peek()).toBe(view.contents)
})

it('does not open on a newer source when the original model changes while WASM loads', async () => {
  const view = await fixture()
  const wasmReady = Promise.withResolvers<ModuleType>()
  view.context.wasm = wasmReady.promise
  const pending = createModelingDialog(
    view.context,
    extrudeTool,
    false,
    () => {}
  )
  view.editor.dispatch({
    changes: { from: 0, insert: '// Changed before opening\n' },
  })
  wasmReady.resolve(wasm)
  expect(await pending).toBeInstanceOf(Error)
  expect(view.resource.selection.dialogOpen.peek()).toBe(false)
})

it('requires reopening the tool after a language-version change instead of reusing its old argument schema', async () => {
  const view = await fixture()
  const dialog = await view.open('Extrude')
  const next = '@settings(kclVersion = 2.0)\nanswer = 42'
  view.editor.dispatch({
    changes: { from: 0, to: view.editor.contents.peek().length, insert: next },
  })
  view.context.executor = {
    ...view.context.executor,
    output: signal(
      createExecutorOutput({ contents: next, src: '/main.kcl', running: false })
    ),
  }
  view.resource.runtime.ast.value = assertParse(next, wasm)
  view.resource.selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  expect(dialog.activate('sketches')).toEqual(
    new Error('The KCL version changed. Reopen the tool.')
  )
  expect(dialog.invalidated.peek()).toBe(true)
  await dialog.submit()
  expect(view.editor.contents.peek()).toBe(next)
})

it('focuses Profiles initially and keeps incompatible picks in the dialog scope after Length receives focus', async () => {
  const view = await fixture()
  await view.pick(0)
  const original = view.resource.selection.selected.peek()
  const dialog = await view.open('Extrude')
  await act(async () => {
    render(<ModelingToolDialogView dialog={dialog} />)
  })
  let profiles = await screen.findByRole('button', {
    name: 'Select Profiles',
  })
  expect(profiles).toHaveFocus()
  expect(profiles).toHaveAttribute('aria-pressed', 'true')
  await act(async () => {
    await view.pick(1)
  })
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [{ entityRef: { region_id: '1' } }] },
  })
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Argument mode' }), {
      target: { value: 'editors.code' },
    })
  })
  const code = await screen.findByRole('textbox')
  expect(code).toHaveTextContent('"sketches"')
  expect(code).toHaveTextContent('"region_id": "1"')
  await act(async () => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Argument mode' }), {
      target: { value: 'modeling-arguments.form' },
    })
  })
  profiles = await screen.findByRole('button', { name: 'Select Profiles' })
  await act(async () => {
    screen.getByRole('textbox', { name: /^length\b/i }).focus()
  })
  expect(profiles).toHaveAttribute('aria-pressed', 'false')
  await act(async () => {
    await view.pick(0)
  })
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [{ entityRef: { region_id: '1' } }] },
  })
  expect(dialog.unusedSelection.peek().map((value) => value.reference)).toEqual(
    [{ type: 'region', region_id: '0' }]
  )
  expect(view.resource.selection.displayed.peek()).toEqual(
    dialog.unusedSelection.peek()
  )
  expect(view.resource.selection.selected.peek()).toBe(original)
})

it('shows picks in Code, allows removing them there, and rejects references without a current picking receipt', async () => {
  const view = await fixture()
  await view.pick(0)
  const dialog = await view.open('Extrude')
  expect(JSON.parse(dialog.editor.contents.peek())).toMatchObject({
    length: '5',
    sketches: [{ type: 'region', region_id: '0' }],
  })
  const replace = (data: unknown) =>
    dialog.editor.dispatch({
      changes: {
        from: 0,
        to: dialog.editor.contents.peek().length,
        insert: JSON.stringify(data),
      },
      userEvent: 'input.type',
    })
  replace({ length: '5', sketches: [] })
  expect(dialog.values.peek()).toMatchObject({
    sketches: { graphSelections: [] },
  })
  replace({ length: '5', sketches: [{ type: 'region', region_id: '1' }] })
  expect(dialog.values.peek()).toBeInstanceOf(Error)
  await dialog.submit()
  expect(view.editor.contents.peek()).toBe(view.contents)
  dialog.activate('sketches')
  await view.pick(1)
  expect(JSON.parse(dialog.editor.contents.peek()).sketches).toEqual([
    { type: 'region', region_id: '1' },
  ])
  expect(dialog.values.peek()).not.toBeInstanceOf(Error)
  view.resource.selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  dialog.activate('sketches')
  replace({ length: '5', sketches: [{ type: 'region', region_id: '1' }] })
  expect(dialog.values.peek()).toBeInstanceOf(Error)
})

it('automatically fills compatible empty arguments in order, then highlights temporary dialog picks without writing the draft', async () => {
  const view = await fixture()
  const { createModelingDialog } = await import('@src/lib/kcl/modelingDialog')
  const definition = {
    id: 'test.pair',
    name: 'Pair',
    icon: 'loft' as const,
    arguments: {
      sketches: {
        inputType: 'selection' as const,
        required: true,
        selectionTypes: ['engineRegion' as const],
        multiple: false,
      },
      second: {
        inputType: 'selection' as const,
        required: true,
        selectionTypes: ['engineRegion' as const],
        multiple: false,
      },
    },
    codemod: {
      transform: () => new Error('This test only collects arguments.'),
    },
  }
  const dialog = requireValue(
    await createModelingDialog(view.context, definition, false, () => {})
  )
  cleanup.push(dialog.cancel)
  await view.pick(0)
  expect(JSON.parse(dialog.editor.contents.peek())).toEqual({
    sketches: [{ type: 'region', region_id: '0' }],
  })
  await view.pick(1)
  expect(JSON.parse(dialog.editor.contents.peek())).toMatchObject({
    second: [{ type: 'region', region_id: '1' }],
  })
  const before = dialog.editor.contents.peek()
  await view.pick(0)
  expect(dialog.editor.contents.peek()).toBe(before)
  expect(dialog.unusedSelection.peek().map((value) => value.reference)).toEqual(
    [{ type: 'region', region_id: '0' }]
  )
  expect(view.resource.selection.displayed.peek()).toEqual(
    dialog.unusedSelection.peek()
  )
  dialog.cancel()
  expect(view.resource.selection.displayed.peek()).toEqual([])
})

it('submits its argument picks and ignores a temporary dialog selection', async () => {
  const view = await fixture()
  await view.pick(0)
  const dialog = await view.open('Extrude')
  await view.pick(1)
  expect(dialog.unusedSelection.peek().map((value) => value.reference)).toEqual(
    [{ type: 'region', region_id: '1' }]
  )
  await dialog.submit()
  expect(dialog.error.peek()).toBeUndefined()
  const queries = view.resource.commands.sendSceneCommand.mock.calls
    .map(([raw]) => raw as EngineCommand)
    .flatMap((request) =>
      request.type === 'modeling_cmd_req' &&
      request.cmd.type === 'region_get_query_point'
        ? [request.cmd.region_id]
        : []
    )
  expect(queries).toEqual(['0'])
})

it('continues an automatically chosen multi-selection argument with Shift-click', async () => {
  const view = await fixture()
  const dialog = await view.open('Loft')
  await view.pick(0)
  await view.pick(1, true)
  expect(JSON.parse(dialog.editor.contents.peek()).sketches).toEqual([
    { type: 'region', region_id: '0' },
    { type: 'region', region_id: '1' },
  ])
  expect(dialog.unusedSelection.peek()).toEqual([])
})

it('does not invalidate review when only unused dialog selection changes', async () => {
  const view = await fixture()
  await view.pick(0)
  const dialog = await view.open('Extrude')
  const review = Promise.withResolvers<Error | undefined>()
  view.resource.runtime.validate.mockImplementation(() => review.promise)
  const pending = dialog.submit()
  await vi.waitFor(() =>
    expect(view.resource.runtime.validate).toHaveBeenCalled()
  )
  await view.pick(1)
  expect(dialog.unusedSelection.peek()).toHaveLength(1)
  review.resolve(undefined)
  await pending
  expect(dialog.error.peek()).toBeUndefined()
  expect(view.editor.contents.peek()).toContain('extrude(')
})

it('keeps Form/Code and dialog-owned picks while submitting through the machine command actor', async () => {
  const view = await fixture()
  await view.pick(0)
  const ordinary = view.resource.selection.selected.peek()
  const restore = vi.fn()
  const handoff = view.resource.selection.handoff({
    enabled: signal(true),
    clear: vi.fn(),
    setFilter: () => undefined,
    restore,
  })
  cleanup.push(handoff.release)
  const submit = vi.fn(async () => {})
  const command = {
    ...requireValue(toolCommand(extrudeTool, view.contents, wasm, false)),
    groupId: 'modeling',
    useModelingDialog: true,
    needsReview: false,
    onSubmit: submit,
  }
  const actor = createActor(commandBarMachine, {
    input: {
      commands: [command],
      wasmInstancePromise: Promise.resolve(wasm),
      machineManager: new MachineManager(),
    },
  }).start()
  cleanup.push(() => actor.stop())
  const state = signal(actor.getSnapshot())
  const subscription = actor.subscribe((next) => {
    state.value = next
  })
  cleanup.push(() => subscription.unsubscribe())
  const dialogs = bindMachineDialogs(
    view.context,
    {
      actor,
      send: (event) => actor.send(event),
      useState: () => {
        throw new Error('No React owner is needed to submit a command')
      },
    },
    false,
    state
  )
  cleanup.push(dialogs.dispose)
  actor.send({
    type: 'Find and select command',
    data: { name: 'Extrude', groupId: 'modeling' },
  })
  await vi.waitFor(() => expect(dialogs.active.peek()).toBeDefined())
  const dialog = dialogs.active.peek()!
  dialog.save('length', 'height')
  const formMode = dialog.editors.viewState(dialog.instance).peek().selected!.id
  expect(dialog.setMode('editors.code')).toBeUndefined()
  expect(JSON.parse(dialog.editor.contents.peek())).toMatchObject({
    sketches: [{ type: 'region', region_id: '0' }],
    length: 'height',
  })
  expect(dialog.setMode(formMode)).toBeUndefined()
  await dialog.submit()
  expect(submit).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      sketches: expect.objectContaining({
        otherSelections: [
          expect.objectContaining({ type: 'engineRegion', id: '0' }),
        ],
      }),
    })
  )
  expect(view.editor.contents.peek()).toBe(view.contents)
  expect(view.resource.selection.selected.peek()).toBe(ordinary)
  expect(restore).toHaveBeenCalledOnce()
})
