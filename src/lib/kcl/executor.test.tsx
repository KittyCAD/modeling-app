import type { ExecState } from '@src/lang/wasm'
import { fakeKclRuntime } from '@src/lib/kcl/testHelpers/runtime'
import '@src/lib/projectSession/next/testFeature'
import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { executionContext } from '@src/lib/executors/context'
import { defineEditorView } from '@src/lib/editors/views'
import {
  editorsService,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
  type CapabilityData,
  type Executor,
} from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import type { KclStreamView } from '@src/lib/kcl/session'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeAll, expect, expectTypeOf, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
afterEach(cleanup)

it.each([false, true])(
  'keeps each executor session isolated and releases it on close (project sources: %s)',
  async (projectSources) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(360)
    const viewers: KclStreamView[] = []
    const runtime = fakeKclRuntime()
    const submit = runtime.execute
    const execution = createKclExecution(
      async () => {
        const viewer = Object.assign(new EventTarget(), {
          el: document.createElement('div'),
          start: vi.fn(),
          rtc: Object.assign(new EventTarget(), {
            send: vi.fn(async () => ({})),
          }),
          deconstructor: vi.fn(),
        })
        viewers.push(viewer)
        return viewer
      },
      async () => runtime,
      undefined,
      projectSources
        ? async (contents, { src }) => new Map([[src, contents]])
        : undefined
    )
    expectTypeOf<CapabilityData<typeof execution.capability>>().toEqualTypeOf<{
      result: ExecState
    }>()
    const registry = new Registry()
    registry.configure([
      editorsExtension,
      executorsExtension,
      defineRegistryItem({
        provides: [provide(executorCapabilityValueSpec, execution.capability)],
      }),
    ])
    const editor = registry
      .get(editorsService)
      .openEditor('/test.kcl', 'contents')
    const executors = registry.get(executorsService)
    const first = executors.createExecutor(editor)
    const second = executors.createExecutor(editor)
    const firstSession = execution.getSession(first)
    const secondSession = execution.getSession(second)
    const view = render(
      <StrictMode>
        <KclScene
          executor={first}
          capability={execution.capability}
          session={firstSession}
        />
      </StrictMode>
    )
    try {
      expect(firstSession).not.toBe(secondSession)
      expect(execution.getSession(first)).toBe(firstSession)
      expect(screen.getByRole('status')).toHaveTextContent('Connecting')
      expect(screen.getByTestId('loading')).toBeInTheDocument()
      secondSession.mount(document.createElement('div'))
      await act(async () => {
        await Promise.resolve()
        viewers.forEach((viewer) => viewer.dispatchEvent(new Event('ready')))
      })
      await vi.waitFor(() => expect(first.output.value.running).toBe(false))
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
      expect(firstSession.element).toBeInTheDocument()
      act(() => {
        editor.dispatch({
          changes: {
            from: 0,
            to: editor.state.doc.length,
            insert: 'edited',
          },
        })
      })
      expect(firstSession.element).toBeInTheDocument()
      await vi.waitFor(() =>
        expect(submit).toHaveBeenCalledWith(
          projectSources ? new Map([['/test.kcl', 'edited']]) : 'edited',
          '/test.kcl'
        )
      )
      view.unmount()
      expect(viewers[0].deconstructor).not.toHaveBeenCalled()
      executors.closeExecutor(first.id)
      await vi.waitFor(() =>
        expect(viewers[0].deconstructor).toHaveBeenCalledOnce()
      )
      expect(viewers[1].deconstructor).not.toHaveBeenCalled()
      registry.get(editorsService).closeEditor(editor.id)
      await vi.waitFor(() =>
        expect(viewers[1].deconstructor).toHaveBeenCalledOnce()
      )
    } finally {
      registry[Symbol.dispose]()
    }
  }
)

it('owns a distinct scene session for each Modeling view of one document', () => {
  const execution = createKclExecution(
    async () => new Error('No engine needed for ownership'),
    async () => fakeKclRuntime()
  )
  const registry = new Registry()
  const bound: Executor[] = []
  registry.configure([
    editorsExtension,
    executorsExtension,
    defineRegistryItem({
      provides: [
        provide(
          editorViewValueSpec,
          defineEditorView((host) => {
            const context = executionContext(
              execution.capability,
              () => registry.get(executorsService),
              { shared: false }
            )(host)
            bound.push(context.executor)
            return context
          })({
            id: 'scene',
            label: 'Modeling',
            matches: '*',
            priority: 1000,
            Component: () => null,
          })
        ),
      ],
    }),
  ])
  try {
    const editors = registry.get(editorsService)
    const editor = editors.createEditor()
    const first = editors.createView(editor)
    editors.createView(editor)
    expect(bound).toHaveLength(2)
    expect(bound[0]).not.toBe(bound[1])
    expect(execution.getSession(bound[0]).element).not.toBe(
      execution.getSession(bound[1]).element
    )
    editors.closeView(first.id)
    expect(registry.get(executorsService).executors.peek()).toEqual([bound[1]])
    expect(editor.signal.aborted).toBe(false)
  } finally {
    registry[Symbol.dispose]()
  }
})
