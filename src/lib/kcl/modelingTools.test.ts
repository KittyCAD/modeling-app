import { beforeEach, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals-core'
import {
  createModelingTools,
  type ModelingToolDefinition,
} from '@src/lib/kcl/modelingTools'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import {
  createModelingDialog,
  type ModelingToolDialog,
} from '@src/lib/kcl/modelingDialog'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'
vi.mock('@src/lib/kcl/modelingDialog', () => ({
  createModelingDialog: vi.fn(),
}))
vi.mock('@src/lib/kcl/stdlibTools', () => ({ extrudeTool: {}, loftTool: {} }))
beforeEach(() => vi.clearAllMocks())

it('disposes a dialog that finishes opening after its Modeling view closes', async () => {
  const view = modelingTestContext()
  view.resource.runtime.ast.value = {} as Node<Program>
  const opening = Promise.withResolvers<ModelingToolDialog>()
  vi.mocked(createModelingDialog).mockReturnValueOnce(opening.promise)
  const pending = view.context.tools.open('kcl.extrude')
  await vi.waitFor(() => expect(createModelingDialog).toHaveBeenCalled())
  view.dispose()
  const cancel = vi.fn()
  opening.resolve({ cancel } as unknown as ModelingToolDialog)
  await pending
  expect(cancel).toHaveBeenCalledOnce()
  expect(view.context.tools.active.peek()).toBeUndefined()
  expect(view.context.tools.opening.peek()).toBe(false)
})

it('opens a contributed tool by ID without dispatching a built-in command', async () => {
  const view = modelingTestContext()
  view.resource.runtime.ast.value = {} as Node<Program>
  const cancel = vi.fn()
  const dialog = { cancel } as unknown as ModelingToolDialog
  const createDialog = vi.fn<ModelingToolDefinition['createDialog']>(
    async () => dialog
  )
  const definitions = signal<readonly ModelingToolDefinition[]>([])
  const tools = createModelingTools(() => view.context, definitions)
  definitions.value = [
    { id: 'test.custom', name: 'Custom', icon: 'extrude', createDialog },
  ]
  await tools.open('test.custom')
  expect(tools.active.peek()).toBe(dialog)
  expect(createDialog.mock.calls[0]?.[0]).toBe(view.context)
  expect(createModelingDialog).not.toHaveBeenCalled()
  definitions.value = []
  await tools.open('test.custom')
  expect(cancel).toHaveBeenCalledOnce()
  expect(tools.active.peek()).toBeUndefined()
  expect(tools.error.peek()?.message).toContain('not registered')
  tools.dispose()
  view.dispose()
})

it('rejects an unknown tool instead of opening Loft', async () => {
  const view = modelingTestContext()
  view.resource.runtime.ast.value = {} as Node<Program>
  await view.context.tools.open('missing')
  expect(view.context.tools.error.peek()?.message).toContain('not registered')
  expect(createModelingDialog).not.toHaveBeenCalled()
  view.dispose()
})

it('discards a contributed dialog when its source changes while opening', async () => {
  const view = modelingTestContext()
  view.resource.runtime.ast.value = {} as Node<Program>
  const opening = Promise.withResolvers<ModelingToolDialog>()
  const tools = createModelingTools(
    () => view.context,
    signal([
      {
        id: 'test.delayed',
        name: 'Delayed',
        icon: 'extrude' as const,
        createDialog: async () => opening.promise,
      },
    ])
  )
  const pending = tools.open('test.delayed')
  view.editor.dispatch({ changes: { from: 0, insert: '// Changed\n' } })
  const cancel = vi.fn()
  opening.resolve({ cancel } as unknown as ModelingToolDialog)
  await pending
  expect(cancel).toHaveBeenCalledOnce()
  expect(tools.active.peek()).toBeUndefined()
  expect(tools.error.peek()?.message).toContain('model changed')
  tools.dispose()
  view.dispose()
})
