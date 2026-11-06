import '@src/lib/projectSession/next/testFeature'
import { undo } from '@codemirror/commands'
import { Registry } from '@kittycad/registry'
import { EditorsPane } from '@src/lib/editors/EditorsPane'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  type EditorsService,
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

const layout = {
  id: 'editors',
  label: 'Editors',
  type: LayoutType.Simple,
  areaType: 'editors',
} as const

describe('EditorsPane', () => {
  let registry: Registry
  let service: EditorsService
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    registry = new Registry()
    registry.configure([editorsExtension])
    service = registry.get(editorsService)
  })
  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
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
