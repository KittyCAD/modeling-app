import '@src/lib/projectSession/next/testFeature'
import { useSignals } from '@preact/signals-react/runtime'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { OPEN_EXECUTOR_COMMAND } from '@src/lib/executors/commands'
import { ExecutorView } from '@src/lib/executors/ExecutorView'
import executorsExtension from '@src/lib/executors/registry'
import {
  executorCapabilityValueSpec,
  executorsService,
  executorViewValueSpec,
  type Executor,
  type ExecutorViewContribution,
} from '@src/lib/executors/registry/contract'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import projectSessionNextExtension from '@src/lib/projectSession/registry'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { Popover } from '@headlessui/react'
import type { PropsWithChildren } from 'react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))
// Anchoring/top-layer behavior is covered by ToolbarDropdownPanel tests and browser checks.
vi.mock('@src/components/ToolbarDropdownPanel', () => ({
  ToolbarDropdownPanel: ({ children }: PropsWithChildren) => (
    <Popover.Panel>
      <ul>{children}</ul>
    </Popover.Panel>
  ),
}))
const mounted = vi.fn()
function Preview({ executor }: { executor: Executor }) {
  useSignals()
  useEffect(() => {
    mounted()
  }, [])
  const output = executor.output.value
  return (
    <p>
      {output.running
        ? 'Rendering...'
        : String(output.data.markdown?.text ?? '')}
    </p>
  )
}
const preview: ExecutorViewContribution = {
  id: 'markdown.preview',
  label: 'Markdown preview',
  matches: '.md',
  capabilityId: 'markdown',
  Component: Preview,
}

describe('executor view binding', () => {
  let registry: Registry
  let slot: Slot
  const readFile = vi.fn<(src: string) => Promise<Uint8Array>>()
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    mounted.mockClear()
    readFile
      .mockReset()
      .mockResolvedValue(new TextEncoder().encode('from disk'))
    registry = new Registry()
    slot = new Slot()
    registry.configure([
      editorsExtension,
      executorsExtension,
      projectSessionNextExtension,
      slot.of(),
    ])
    registry.get(projectSessionService).openProject({
      contents: {
        name: 'project',
        path: '/project',
        children: [
          { name: 'notes.md', path: '/project/notes.md', children: null },
          { name: 'other.MD', path: '/project/other.MD', children: null },
          { name: 'main.kcl', path: '/project/main.kcl', children: null },
          { name: 'plain.txt', path: '/project/plain.txt', children: null },
        ],
      },
      metadata: { title: 'Project', readWriteAccess: true },
    })
    contribute([preview])
  })
  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
  })
  const contribute = (views: ExecutorViewContribution[]) =>
    registry.reconfigure(slot, [
      defineRegistryItem({
        id: 'preview-test',
        providesServices: [
          provideService(fileOperationsService, {
            ...testFileOperations,
            readFile,
          }),
        ],
        provides: [
          provide(executorCapabilityValueSpec, {
            id: 'markdown',
            matches: '.md',
            execute: (contents: string) => ({ text: contents.toUpperCase() }),
          }),
          ...views.map((view) => provide(executorViewValueSpec, view)),
        ],
      }),
    ])

  const openCommand = () =>
    registry
      .get(commandsValueSpec)
      .find(({ id }) => id === OPEN_EXECUTOR_COMMAND.id)!
  const onOpen = vi.fn()
  const renderView = () =>
    render(
      <ExecutorView
        executors={registry.get(executorsService)}
        views={registry.signal(executorViewValueSpec)}
        capabilities={registry.signal(executorCapabilityValueSpec)}
        onOpenExecutor={onOpen}
      />
    )
  const options = (
    command: ReturnType<typeof openCommand>,
    arg: string,
    src?: unknown
  ) => {
    const argument = command.args![arg]
    expect(argument.inputType).toBe('options')
    if (argument.inputType !== 'options') return []
    return typeof argument.options === 'function'
      ? argument.options({ argumentsToSubmit: { src } })
      : argument.options
  }
  const add = (src: string, contents: string) => {
    const editor = registry.get(editorsService).openEditor(src, contents)
    const tab = registry.get(executorsService).openView(editor, preview.id)
    return { editor, tab }
  }

  it('keeps the add action available without tabs', () => {
    onOpen.mockClear()
    renderView()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open executor' }))
    expect(onOpen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Open a file' }))
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { level: 2 })).toBeVisible()
  })

  it('opens multiple independent tabs, selects new tabs, and preserves inactive views', async () => {
    const { editor: first } = add('/project/notes.md', 'first')
    renderView()
    await screen.findByText('FIRST')
    act(() => {
      add('/project/other.MD', 'second')
    })
    const secondTab = screen.getByRole('tab', {
      name: 'other.MD - Markdown preview',
    })
    expect(secondTab).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('SECOND')
    fireEvent.click(
      screen.getByRole('tab', { name: 'notes.md - Markdown preview' })
    )
    expect(screen.getByText('FIRST')).toBeVisible()
    expect(screen.getByText('SECOND')).not.toBeVisible()
    expect(mounted).toHaveBeenCalledTimes(2)
    act(() => {
      registry.get(editorsService).openEditor('/project/plain.txt', 'unrelated')
    })
    expect(
      screen.getByRole('tab', { name: 'notes.md - Markdown preview' })
    ).toHaveAttribute('aria-selected', 'true')
    act(() => {
      first.view.dispatch({ changes: { from: 0, to: 5, insert: 'updated' } })
    })
    expect(await screen.findByText('UPDATED')).toBeVisible()
  })

  it('closes only the chosen executor and selects a neighboring tab, keeping editors alive', () => {
    const { editor, tab } = add('/project/notes.md', 'first')
    const { tab: second } = add('/project/notes.md', 'second')
    const destroy = vi.spyOn(editor.view, 'destroy')
    renderView()
    const tabs = screen.getAllByRole('tab')
    act(() => tabs[1].focus())
    fireEvent.keyDown(tabs[1], { key: 'Delete' })
    expect(registry.get(executorsService).executors.value).toEqual([
      tab.executor,
    ])
    expect(
      registry
        .get(executorsService)
        .viewTabs.value.some((item) => item.executor === second.executor)
    ).toBe(false)
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(
      screen.getByRole('button', { name: 'Close notes.md - Markdown preview' })
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open executor' })).toBeVisible()
    expect(destroy).not.toHaveBeenCalled()
    expect(registry.get(editorsService).editors.value).toHaveLength(2)
  })

  it('tracks renamed sources and unavailable contributions without silently rebinding a view', async () => {
    const { editor } = add('/project/notes.md', 'notes')
    renderView()
    act(() =>
      registry.get(editorsService).setSource(editor.id, '/project/renamed.MD')
    )
    expect(
      screen.getByRole('tab', { name: 'renamed.MD - Markdown preview' })
    ).toHaveAttribute('title', '/project/renamed.MD')
    act(() => contribute([]))
    expect(
      await screen.findByText('No executor view is available for this file.')
    ).toBeVisible()
    act(() => contribute([preview]))
    expect(
      screen.getByRole('tab', { name: 'renamed.MD - Markdown preview' })
    ).toBeVisible()
    act(() => registry.get(editorsService).closeEditor(editor.id))
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('keeps separate view contributions for the same editor as independent tabs', () => {
    const alternate = {
      ...preview,
      id: 'markdown.alternate',
      label: 'Alternate preview',
    }
    contribute([preview, alternate])
    const { editor } = add('/project/notes.md', 'notes')
    registry.get(executorsService).openView(editor, alternate.id)
    renderView()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(
      screen.getByRole('tab', { name: 'notes.md - Alternate preview' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(registry.get(executorsService).executors.value).toHaveLength(2)
  })

  it('switches only the chosen tab view, retaining independent executors and their output', async () => {
    const alternate = {
      ...preview,
      id: 'markdown.alternate',
      label: 'Alternate preview',
      Component: ({ executor }: { executor: Executor }) => (
        <p>Alternate: {executor.output.peek().contents}</p>
      ),
    }
    contribute([preview, alternate])
    const first = add('/project/notes.md', 'first')
    const second = add('/project/notes.md', 'second')
    renderView()
    await vi.waitFor(() => {
      expect(first.tab.executor.output.peek().running).toBe(false)
      expect(second.tab.executor.output.peek().running).toBe(false)
    })
    const output = first.tab.executor.output.peek()
    const picker = screen.getAllByRole('button', {
      name: 'View for notes.md',
    })[0]
    expect(screen.getAllByRole('tab')[0]).not.toContainElement(picker)
    act(() => picker.focus())
    fireEvent.click(picker)
    fireEvent.click(
      await screen.findByRole('button', { name: alternate.label })
    )
    const service = registry.get(executorsService)
    expect(service.viewTabs.peek().map(({ viewId }) => viewId)).toEqual([
      alternate.id,
      preview.id,
    ])
    expect(service.executors.peek()).toEqual([
      first.tab.executor,
      second.tab.executor,
    ])
    expect(first.tab.executor.output.peek()).toBe(output)
    expect(screen.getByText('Alternate: first')).toBeVisible()
  })

  it('updates view choices with contributions and lets an unavailable tab recover without rebinding its editor', async () => {
    const { tab } = add('/project/notes.md', 'notes')
    renderView()
    expect(
      screen.queryByRole('button', { name: 'View for notes.md' })
    ).not.toBeInTheDocument()
    expect(screen.getByText(preview.label)).toBeVisible()
    const alternate = {
      ...preview,
      id: 'markdown.alternate',
      label: 'Alternate preview',
    }
    act(() => contribute([preview, alternate]))
    fireEvent.click(screen.getByRole('button', { name: 'View for notes.md' }))
    fireEvent.click(
      await screen.findByRole('button', { name: alternate.label })
    )
    act(() => contribute([preview]))
    expect(
      await screen.findByText('No executor view is available for this file.')
    ).toBeVisible()
    const service = registry.get(executorsService)
    act(() => service.setView(tab.executor.id, 'removed.view'))
    expect(service.viewTabs.peek()[0].viewId).toBe(alternate.id)
    fireEvent.click(screen.getByRole('button', { name: 'View for notes.md' }))
    fireEvent.click(await screen.findByRole('button', { name: preview.label }))
    expect(service.viewTabs.peek()[0].executor).toBe(tab.executor)
    expect(service.viewTabs.peek()[0].viewId).toBe(preview.id)
    expect(
      screen.queryByRole('button', { name: 'View for notes.md' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('No executor view is available for this file.')
    ).not.toBeInTheDocument()
  })

  it('offers eligible project files and distinct open editors, with views dependent on the source', () => {
    const editors = registry.get(editorsService)
    editors.openEditor('/shared.md', 'one')
    editors.openEditor('/shared.md', 'two')
    editors.openEditor('/plain.txt', 'plain')
    contribute([
      preview,
      { ...preview, id: 'missing', capabilityId: 'missing' },
    ])
    const command = openCommand()
    const choices = options(command, 'src')
    expect(choices.map(({ value }) => value)).toContain('/project/other.MD')
    expect(
      choices.some(
        ({ name }) => name.includes('main.kcl') || name.includes('plain.txt')
      )
    ).toBe(false)
    const shared = choices.filter(({ name }) => name.includes('shared.md'))
    expect(shared).toHaveLength(2)
    expect(shared[0].value).not.toBe(shared[1].value)
    expect(options(command, 'view', shared[1].value)).toEqual([
      { name: preview.label, value: preview.id },
    ])
  })

  it('loads an unopened file, creates a tab from the command, and reuses unsaved editors on later opens', async () => {
    renderView()
    const command = openCommand()
    await act(async () => {
      await command.onSubmit({ src: '/project/notes.md' })
    })
    expect(readFile).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('tab', { name: 'notes.md - Markdown preview' })
    ).toBeVisible()
    const editor = registry.get(editorsService).editors.value[0]
    editor.view.dispatch({
      changes: { from: 0, to: editor.view.state.doc.length, insert: 'unsaved' },
    })
    const src = options(command, 'src').find(({ name }) =>
      name.includes('notes.md')
    )!.value
    await act(async () => {
      await command.onSubmit({ src })
    })
    expect(registry.get(editorsService).editors.value).toHaveLength(1)
    expect(registry.get(executorsService).viewTabs.value).toHaveLength(2)
    expect(editor.view.state.doc.toString()).toBe('unsaved')
    expect(readFile).toHaveBeenCalledOnce()
  })

  it('opens the requested contributed view and cancels a superseded file read', async () => {
    const alternate = {
      ...preview,
      id: 'markdown.alternate',
      label: 'Alternate preview',
    }
    contribute([preview, alternate])
    let finish!: (contents: Uint8Array) => void
    readFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const command = openCommand()
    const stale = command.onSubmit({ src: '/project/notes.md' })
    const result = await command.onSubmit({
      src: '/project/other.MD',
      view: alternate.id,
    })
    expect(result).not.toBeInstanceOf(Error)
    finish(new TextEncoder().encode('stale'))
    expect(await stale).toBeInstanceOf(Error)
    const tabs = registry.get(executorsService).viewTabs.value
    expect(tabs).toHaveLength(1)
    expect(tabs[0].viewId).toBe(alternate.id)
    expect(tabs[0].executor.editor.src.value).toBe('/project/other.MD')
    expect(registry.get(editorsService).editors.value).toHaveLength(1)
  })

  it('reuses an editor opened while a read is pending', async () => {
    let finish!: (contents: Uint8Array) => void
    readFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const result = openCommand().onSubmit({ src: '/project/notes.md' })
    const editor = registry
      .get(editorsService)
      .openEditor('/project/notes.md', 'new unsaved contents')
    finish(new TextEncoder().encode('stale disk'))
    await result
    expect(
      registry.get(executorsService).viewTabs.value[0].executor.editor
    ).toBe(editor)
    expect(editor.view.state.doc.toString()).toBe('new unsaved contents')
  })

  it.each(['cancel', 'project switch', 'dispose'])(
    'does not publish stale editors or tabs after %s during a read',
    async (reason) => {
      let finish!: (contents: Uint8Array) => void
      readFile.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const command = openCommand()
      const result = command.onSubmit({ src: '/project/notes.md' })
      const editors = registry.get(editorsService)
      const executors = registry.get(executorsService)
      if (reason === 'dispose') {
        registry[Symbol.dispose]()
        registry = new Registry()
      } else if (reason === 'cancel') command.onCancel?.()
      else registry.get(projectSessionService).closeProject()
      finish(new TextEncoder().encode('stale disk'))
      expect(await result).toBeInstanceOf(Error)
      expect(editors.editors.value).toHaveLength(0)
      expect(executors.viewTabs.value).toHaveLength(0)
    }
  )

  it('reports failed reads and refuses a view removed while loading', async () => {
    const command = openCommand()
    readFile.mockRejectedValueOnce(new Error('Disk unavailable'))
    expect(await command.onSubmit({ src: '/project/notes.md' })).toEqual(
      new Error('Disk unavailable')
    )
    let finish!: (contents: Uint8Array) => void
    readFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const result = command.onSubmit({ src: '/project/notes.md' })
    contribute([])
    finish(new TextEncoder().encode('disk'))
    expect(await result).toBeInstanceOf(Error)
    expect(registry.get(executorsService).viewTabs.value).toHaveLength(0)
  })
})
