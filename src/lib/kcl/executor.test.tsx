import type { KclSceneViewExtension } from '@src/lib/kcl/registry/contract'
import '@src/lib/projectSession/next/testFeature'
import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
  type CapabilityData,
} from '@src/lib/executors/registry/contract'
import { createKclExecution } from '@src/lib/kcl/executor'
import { KclScene } from '@src/lib/kcl/KclScene'
import type { KclStreamView } from '@src/lib/kcl/session'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
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
    const submit = vi.fn(async () => ({ values: {} }))
    const execution = createKclExecution(
      async () => {
        const worker = new EventTarget()
        const viewer = Object.assign(new EventTarget(), {
          el: document.createElement('div'),
          start: vi.fn(),
          rtc: Object.assign(new EventTarget(), {
            executor: () => ({
              submit,
              addEventListener: worker.addEventListener.bind(worker, 'message'),
              removeEventListener: worker.removeEventListener.bind(
                worker,
                'message'
              ),
            }),
            send: vi.fn(async () => ({})),
          }),
          deconstructor: vi.fn(),
        })
        viewers.push(viewer)
        return viewer
      },
      undefined,
      projectSources
        ? async (contents, { src }) => new Map([[src, contents]])
        : undefined
    )
    expectTypeOf<CapabilityData<typeof execution.capability>>().toEqualTypeOf<{
      result: unknown
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
    const selected = vi.fn()
    const extensions: KclSceneViewExtension[] = [
      {
        id: 'test.modeling-tool',
        zone: 'top',
        Component: ({ executor, session }) => (
          <button onClick={() => selected(executor, session)}>
            Modeling tool
          </button>
        ),
      },
    ]
    const firstSession = execution.getSession(first)
    const secondSession = execution.getSession(second)
    const view = render(
      <StrictMode>
        <KclScene
          executor={first}
          capability={execution.capability}
          session={firstSession}
          extensions={extensions}
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
      fireEvent.click(view.getByRole('button', { name: 'Modeling tool' }))
      expect(selected).toHaveBeenCalledExactlyOnceWith(first, firstSession)
      const secondView = render(
        <KclScene
          executor={second}
          capability={execution.capability}
          session={secondSession}
          extensions={extensions}
        />
      )
      fireEvent.click(
        within(secondView.container).getByRole('button', {
          name: 'Modeling tool',
        })
      )
      expect(selected).toHaveBeenLastCalledWith(second, secondSession)
      secondView.unmount()
      act(() => {
        editor.view.dispatch({
          changes: {
            from: 0,
            to: editor.view.state.doc.length,
            insert: 'edited',
          },
        })
      })
      expect(firstSession.element).toBeInTheDocument()
      await vi.waitFor(() =>
        expect(submit).toHaveBeenCalledWith(
          projectSources ? new Map([['/test.kcl', 'edited']]) : 'edited',
          {
            mainKclPathName: '/test.kcl',
          }
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
