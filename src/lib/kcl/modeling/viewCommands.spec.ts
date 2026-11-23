import { expect, it, beforeAll } from 'vitest'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { modelingTestContext } from '@src/lib/kcl/modeling/testContext'
import { setViewFileUnits } from '@src/lib/kcl/modeling/viewCommands'
let wasm: ModuleType
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
it('changes units in the bound document and keeps the edit undoable', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  first.context.wasm = Promise.resolve(wasm)
  const before = first.editor.contents.peek()
  try {
    expect(await setViewFileUnits(first.context, 'in')).toBeUndefined()
    expect(first.editor.contents.peek()).toContain('defaultLengthUnit = in')
    expect(second.editor.contents.peek()).toBe(before)
    expect(first.editor.undo()).toBe(true)
    expect(first.editor.contents.peek()).toBe(before)
  } finally {
    first.dispose()
    second.dispose()
  }
})
it.each(['source edit', 'read-only', 'close'] as const)(
  'leaves the document alone when %s happens while loading WASM',
  async (change) => {
    const view = modelingTestContext()
    let resolve!: (value: ModuleType) => void
    view.context.wasm = new Promise((done) => {
      resolve = done
    })
    try {
      const pending = setViewFileUnits(view.context, 'in')
      if (change === 'source edit')
        view.editor.dispatch({ changes: { from: 0, insert: '// changed\n' } })
      if (change === 'read-only') view.editor.readOnly.value = true
      if (change === 'close') view.dispose()
      const before = view.editor.contents.peek()
      resolve(wasm)
      expect(await pending).toBeInstanceOf(Error)
      expect(view.editor.contents.peek()).toBe(before)
    } finally {
      view.dispose()
    }
  }
)
