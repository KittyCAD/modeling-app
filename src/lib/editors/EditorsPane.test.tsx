import { defineEditorView } from '@src/lib/editors/views'
import '@src/lib/projectSession/next/testFeature'
import { undo } from '@codemirror/commands'
import { defineRegistryItem, provide, Registry, Slot } from '@kittycad/registry'
import { useSignals } from '@preact/signals-react/runtime'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import editorsExtension from '@src/lib/editors/registry'
import {
  type Editor,
  type EditorsService,
  editorsService,
  editorViewValueSpec,
} from '@src/lib/editors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { LayoutType } from '@src/lib/layout/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Panel buttons use navigation helpers; these tests need no application runtime.
vi.mock('@src/lib/paths', () => ({ PATHS: { INDEX: '/' } }))

function FormView({ editor }: { editor: Editor }) {
  useSignals()
  return (
    <textarea
      aria-label="Form buffer"
      value={editor.contents.value}
      onChange={(event) =>
        editor.view.dispatch({
          changes: {
            from: 0,
            to: editor.view.state.doc.length,
            insert: event.target.value,
          },
        })
      }
    />
  )
}

const layout = {
  id: 'editors',
  label: 'Editors',
  type: LayoutType.Simple,
  areaType: 'editors',
} as const

describe('EditorsPane', () => {
  const extraViews = new Slot()
  let registry: Registry
  let service: EditorsService
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    registry = new Registry()
    registry.configure([editorsExtension, extraViews.of()])
    service = registry.get(editorsService)
  })
  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
  })

  it('switches contributed surfaces without replacing the buffer, history, or saved view choice', async () => {
    const editor = service.openEditor('/project/notes.md', 'original')
    const destroy = vi.spyOn(editor.view, 'destroy')
    await registry.reconfigureAsync(extraViews, [
      defineRegistryItem({
        provides: [
          provide(
            editorViewValueSpec,
            defineEditorView({
              id: 'test.form',
              label: 'Form',
              matches: '.md',
              Component: FormView,
            })
          ),
        ],
      }),
    ])
    const pane = render(<EditorsPane editors={service} layout={layout} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Form buffer' }), {
      target: { value: 'edited in form' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mode for notes.md' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Code' }))
    })
    expect(screen.getByRole('tabpanel')).toContainElement(editor.view.dom)
    expect(editor.view.state.doc.toString()).toBe('edited in form')
    pane.unmount()
    render(<EditorsPane editors={service} layout={layout} />)
    expect(screen.getByRole('tabpanel')).toContainElement(editor.view.dom)
    act(() => {
      expect(undo(editor.view)).toBe(true)
    })
    expect(editor.view.state.doc.toString()).toBe('original')
    fireEvent.click(screen.getByRole('button', { name: 'Mode for notes.md' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Form' }))
    })
    expect(screen.getByRole('textbox', { name: 'Form buffer' })).toHaveValue(
      'original'
    )
    await act(async () => {
      await registry.reconfigureAsync(extraViews, [])
    })
    expect(screen.getByRole('tabpanel')).toContainElement(editor.view.dom)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('creates independent unnamed buffers and updates their tabs after naming', () => {
    render(<EditorsPane editors={service} layout={layout} />)
    fireEvent.click(screen.getByRole('button', { name: 'New editor' }))
    const first = service.editors.value[0]
    expect(screen.getByRole('tab', { name: 'Untitled' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toContainElement(first.view.dom)
    fireEvent.click(screen.getByRole('button', { name: 'New editor' }))
    const second = service.editors.value[1]
    expect(second).not.toBe(first)
    act(() => service.setSource(second.id, '/project/new.md'))
    expect(screen.getByRole('tab', { name: 'new.md' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toContainElement(second.view.dom)
    fireEvent.click(screen.getByRole('button', { name: 'Close Untitled' }))
    expect(service.editors.value).toEqual([second])
  })

  it('offers an open-editor action even when no editors are open', () => {
    const onOpenEditor = vi.fn()
    render(
      <EditorsPane
        editors={service}
        layout={layout}
        onOpenEditor={onOpenEditor}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open a file' }))
    expect(onOpenEditor).toHaveBeenCalledTimes(2)
    expect(service.editors.value).toEqual([])
  })

  it('reacts to opening and closing editors, including the empty state', async () => {
    const open = vi.fn()
    render(
      <EditorsPane editors={service} layout={layout} onOpenEditor={open} />
    )
    expect(screen.getByRole('heading', { level: 2 })).toBeVisible()
    let editor: ReturnType<EditorsService['openEditor']>
    await act(async () => {
      editor = service.openEditor('/project/main.kcl', '')
    })
    expect(screen.getByRole('tab', { name: 'main.kcl' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toContainElement(editor!.view.dom)
    expect(screen.getByRole('tablist')).not.toContainElement(
      screen.getByRole('button', { name: 'Open editor' })
    )
    const destroy = vi.spyOn(editor!.view, 'destroy')
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Close /project/main.kcl' })
      )
    })
    expect(destroy).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { level: 2 })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(open).toHaveBeenCalledOnce()
  })

  it('switches the same views without losing edits, selection or history', () => {
    const first = service.openEditor('/project/main.kcl', '')
    const second = service.openEditor('cloud:project/notes.md', '')
    first.view.dispatch({
      changes: { from: 0, insert: 'saved edit' },
      selection: { anchor: 3 },
    })
    const destroy = vi.spyOn(first.view, 'destroy')
    const { unmount } = render(
      <EditorsPane editors={service} layout={layout} />
    )
    expect(screen.getByRole('tabpanel')).toContainElement(second.view.dom)
    fireEvent.click(screen.getByRole('tab', { name: 'main.kcl' }))
    expect(screen.getByRole('tabpanel')).toContainElement(first.view.dom)
    fireEvent.click(screen.getByRole('tab', { name: 'notes.md' }))
    fireEvent.click(screen.getByRole('tab', { name: 'main.kcl' }))
    expect(first.view.state.doc.toString()).toBe('saved edit')
    expect(first.view.state.selection.main.anchor).toBe(3)
    act(() => {
      expect(undo(first.view)).toBe(true)
    })
    expect(first.view.state.doc.toString()).toBe('')
    unmount()
    expect(destroy).not.toHaveBeenCalled()
    expect(first.view.dom.isConnected).toBe(false)
    expect(service.editors.value).toEqual([first, second])
    render(<EditorsPane editors={service} layout={layout} />)
    fireEvent.click(screen.getByRole('tab', { name: 'main.kcl' }))
    expect(screen.getByRole('tabpanel')).toContainElement(first.view.dom)
  })

  it('keeps selection by editor identity when another tab closes', async () => {
    const first = service.openEditor('/project/first.kcl', '')
    const second = service.openEditor('/project/second.kcl', '')
    const third = service.openEditor('/project/third.kcl', '')
    render(<EditorsPane editors={service} layout={layout} />)
    fireEvent.click(screen.getByRole('tab', { name: 'second.kcl' }))
    await act(async () => service.closeEditor(first.id))
    expect(screen.getByRole('tabpanel')).toContainElement(second.view.dom)
    await act(async () => service.closeEditor(second.id))
    expect(screen.getByRole('tabpanel')).toContainElement(third.view.dom)
    await act(async () => {
      service.openEditor('/project/new.kcl', '')
    })
    expect(screen.getByRole('tab', { name: 'new.kcl' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('distinguishes repeated sources and lets Headless UI navigate tabs by keyboard', async () => {
    const first = service.openEditor('/project/main.kcl', '')
    const second = service.openEditor('/project/main.kcl', '')
    const onClose = vi.fn()
    render(<EditorsPane editors={service} layout={layout} onClose={onClose} />)
    const tabs = screen.getAllByRole('tab', { name: 'main.kcl' })
    expect(tabs).toHaveLength(2)
    expect(screen.getByRole('tabpanel')).toContainElement(second.view.dom)
    act(() => tabs[1].focus())
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' })
    expect(tabs[0]).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toContainElement(first.view.dom)
    await act(async () => {
      fireEvent.keyDown(tabs[0], { key: 'Delete' })
    })
    expect(service.editors.value).toEqual([second])
    expect(screen.getByRole('tabpanel')).toContainElement(second.view.dom)
    fireEvent.click(screen.getByRole('button', { name: 'Close Editors pane' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(service.editors.value).toEqual([second])
  })
})
