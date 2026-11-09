import { history, redo, undo } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals-core'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import { assertParse, execStateFromRust, recast } from '@src/lang/wasm'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ExtrudeCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import type { Editor } from '@src/lib/editors/registry/contract'
import {
  prepareStdlibExtrude,
  type KclModelSnapshot,
} from '@src/lib/kcl/stdlibExtrude'
import {
  stringToKclExpression,
  type KclExpressionRuntime,
} from '@src/lib/kclHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, expect, it } from 'vitest'

let wasm: ModuleType
const settings = JSON.stringify({ settings: { modeling: { base_unit: 'mm' } } })
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    `${process.cwd()}/public/kcl_wasm_lib_bg.wasm`
  )
})
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

/** Actual Rust mock execution provides the graph and validates geometry without an engine or KclManager. */
async function model() {
  const contents = recast(
    assertParse(
      `@settings(kclVersion = 3.0, defaultLengthUnit = mm)
height = 24mm
// 🐈 Keep this sketch and its cursor position.
s = sketch(on = XY) {
  c = circle(start = [10mm, 0mm], center = [0mm, 0mm])
  radius(c) == 10mm
}
`,
      wasm
    ),
    wasm
  )
  if (contents instanceof Error) throw contents
  const native = new wasm.Context(
    {
      async sendModelingCommandFromWasm() {
        throw new Error('Mock execution must not contact an engine')
      },
      fireModelingCommandFromWasm() {
        throw new Error('Mock execution must not contact an engine')
      },
      async startNewSession() {},
    },
    {
      async readFile() {
        return new TextEncoder().encode(contents)
      },
      async exists() {
        return true
      },
      async getAllFiles() {
        return [contents]
      },
    },
    undefined,
    true
  )
  cleanup.push(() => native.free())
  const ast = assertParse(contents, wasm)
  const execState = execStateFromRust(
    await native.executeMock(
      JSON.stringify(ast),
      '/project/main.kcl',
      settings,
      false
    )
  )
  const text = signal(contents)
  const source = signal<string | undefined>('/project/main.kcl')
  const edits: { from: number; to: number }[][] = []
  const view = new EditorView({
    doc: contents,
    extensions: [
      history(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        text.value = update.state.doc.toString()
        const changes: { from: number; to: number }[] = []
        update.changes.iterChanges((from, to) => changes.push({ from, to }))
        edits.push(changes)
      }),
    ],
  })
  cleanup.push(() => view.destroy())
  const editor: Editor = {
    id: Symbol(),
    src: source,
    contents: text,
    classification: signal({ languageId: 'kcl' }),
    view,
  }
  let snapshot: KclModelSnapshot | undefined = {
    src: source.peek(),
    contents,
    execState,
  }
  const expressionRuntime: KclExpressionRuntime = {
    wasmInstancePromise: Promise.resolve(wasm),
    evaluateExpression: async (expression) =>
      execStateFromRust(
        await native.evaluateExpression(JSON.stringify(expression), settings)
      ),
    async waitForAllEngineModelingCommands() {},
  }
  const length = await stringToKclExpression('12mm', expressionRuntime)
  if (length instanceof Error || 'errors' in length)
    throw new Error('Unable to resolve the length')
  const sketch = [...execState.artifactGraph.values()].find(
    (artifact) => artifact.type === 'sketchBlock'
  )
  if (!sketch) throw new Error('Mock execution did not produce the sketch')
  const args: ExtrudeCommandArgs = {
    sketches: {
      graphSelections: [],
      otherSelections: [
        {
          type: 'engineRegion',
          id: 'point-at-origin',
          sketchId: sketch.id,
          point: { x: 0, y: 0 },
        },
      ],
    },
    length: {
      ...length,
      variableName: 'depth',
      variableDeclarationAst: createVariableDeclaration(
        'depth',
        length.valueAst
      ),
      variableIdentifierAst: createLocalName('depth'),
      insertIndex: 0,
    },
  }
  const input = {
    editor,
    args,
    wasmInstance: wasm,
    getExecution: () => snapshot,
    validate: async (proposed: typeof ast) => {
      await native.executeMock(
        JSON.stringify(proposed),
        '/project/main.kcl',
        settings,
        false
      )
      return undefined
    },
  }
  return {
    input,
    contents,
    editor,
    source,
    edits,
    native,
    replaceExecution: () => {
      snapshot = snapshot ? { ...snapshot } : undefined
    },
    close: () => {
      snapshot = undefined
    },
  }
}

it('uses the shared stdlib definition and codemod to extrude a region with one transaction of separate edits', async () => {
  const fixture = await model()
  const anchor = fixture.contents.indexOf('radius(c)')
  fixture.editor.view.dispatch({ selection: EditorSelection.cursor(anchor) })
  const prepared = await prepareStdlibExtrude(fixture.input)
  if (prepared instanceof Error) throw prepared
  expect(fixture.editor.contents.value).toBe(fixture.contents)
  expect(prepared.commit()).toBeUndefined()
  expect(fixture.edits).toHaveLength(1)
  expect(fixture.edits[0].length).toBeGreaterThanOrEqual(2)
  expect(
    fixture.edits[0].some(
      (edit) => edit.from === 0 && edit.to === fixture.contents.length
    )
  ).toBe(false)
  const changed = fixture.editor.contents.value
  expect(changed).toContain('depth = 12mm')
  expect(changed).toContain('length = depth')
  expect(changed.slice(fixture.editor.view.state.selection.main.head)).toMatch(
    /^radius\(c\)/
  )
  const outcome = execStateFromRust(
    await fixture.native.executeMock(
      JSON.stringify(assertParse(changed, wasm)),
      '/project/main.kcl',
      settings,
      false
    )
  )
  expect(outcome.variables.extrude001?.type).toBe('Solid')
  expect(undo(fixture.editor.view)).toBe(true)
  expect(fixture.editor.contents.value).toBe(fixture.contents)
  expect(redo(fixture.editor.view)).toBe(true)
  expect(fixture.editor.contents.value).toBe(changed)
})

it.each(['edit', 'rename', 'execution', 'close'] as const)(
  'rejects a prepared edit after the target changes: %s',
  async (change) => {
    const fixture = await model()
    const prepared = await prepareStdlibExtrude(fixture.input)
    if (prepared instanceof Error) throw prepared
    if (change === 'edit')
      fixture.editor.view.dispatch({
        changes: { from: fixture.contents.length, insert: '// newer edit\n' },
      })
    if (change === 'rename') fixture.source.value = '/project/renamed.kcl'
    if (change === 'execution') fixture.replaceExecution()
    if (change === 'close') fixture.close()
    const before = fixture.editor.contents.value
    expect(prepared.commit()).toBeInstanceOf(Error)
    expect(fixture.editor.contents.value).toBe(before)
  }
)

it('does not commit a codemod rejected by review validation', async () => {
  const fixture = await model()
  const error = new Error('The proposed geometry is invalid')
  expect(
    await prepareStdlibExtrude({
      ...fixture.input,
      validate: async () => error,
    })
  ).toBe(error)
  expect(fixture.edits).toEqual([])
})

it('rejects an execution change while asynchronous review is pending', async () => {
  const fixture = await model()
  const started = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  const pending = prepareStdlibExtrude({
    ...fixture.input,
    validate: async () => {
      started.resolve(undefined)
      await finish.promise
      return undefined
    },
  })
  await started.promise
  fixture.replaceExecution()
  finish.resolve(undefined)
  expect(await pending).toBeInstanceOf(Error)
  expect(fixture.edits).toEqual([])
})
