import '@src/lib/projectSession/next/testFeature'
import { language } from '@codemirror/language'
import { Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  editorCapabilityValueSpec,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { createExecutorOutput } from '@src/lib/executors/output'
import {
  executorsService,
  executorCapabilityValueSpec,
  executorViewValueSpec,
  type ExecutorOutput,
} from '@src/lib/executors/registry/contract'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { MarkdownPreview } from '@src/lib/markdown/MarkdownPreview'
import { markdownExecutorCapability } from '@src/lib/markdown/executor'
import markdownExtension from '@src/lib/markdown/registry'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { StrictMode } from 'react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const links = vi.hoisted(() => ({
  open: vi.fn(() =>
    vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
  ),
}))
vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop: links.open,
}))

describe('Markdown extension', () => {
  let registry: Registry
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  beforeEach(() => {
    links.open.mockClear()
    registry = new Registry()
    registry.configure([
      editorsExtension,
      executorsExtension,
      markdownExtension,
    ])
  })
  afterEach(() => {
    cleanup()
    registry[Symbol.dispose]()
  })

  it('contributes editing, execution and a preview from one extension without depending on either service', () => {
    const isolated = new Registry()
    try {
      isolated.configure([markdownExtension])
      expect(
        isolated.get(editorCapabilityValueSpec).map(({ matches }) => matches)
      ).toEqual(['.md'])
      expect(isolated.get(executorCapabilityValueSpec)).toEqual([
        markdownExecutorCapability,
      ])
      expect(isolated.get(executorViewValueSpec)).toEqual([
        expect.objectContaining({
          matches: '.md',
          capabilityId: markdownExecutorCapability.id,
          Component: MarkdownPreview,
        }),
      ])
      expect(isolated.optional(editorsService)).toBeUndefined()
      expect(isolated.optional(executorsService)).toBeUndefined()
    } finally {
      isolated[Symbol.dispose]()
    }
  })

  it('highlights Markdown and executes its contents as a live preview', async () => {
    const editor = registry
      .get(editorsService)
      .openEditor('/README.MD', '# Hello\n\n[Zoo](https://zoo.dev)')
    expect(editor.view.state.facet(language)?.name).toBe('markdown')
    const executor = registry.get(executorsService).createExecutor(editor)
    render(<MarkdownPreview executor={executor} />)
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeVisible()
    const link = screen.getByRole('link', { name: 'Zoo' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(link)
    expect(links.open).toHaveBeenCalledWith('https://zoo.dev/')
    act(() => {
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
          insert: '# Changed\n\nUnsaved contents',
        },
      })
    })
    expect(
      await screen.findByRole('heading', { name: 'Changed' })
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Hello' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Unsaved contents')).toBeVisible()
    expect(executor.output.value.errors).toEqual({})
  })

  it('uses the existing renderer to escape raw HTML and reject executable links', async () => {
    const editor = registry
      .get(editorsService)
      .openEditor(
        'unsafe.md',
        '# Preview\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>'
      )
    const executor = registry.get(executorsService).createExecutor(editor)
    const { container } = render(<MarkdownPreview executor={executor} />)
    await screen.findByRole('heading', { name: 'Preview' })
    expect(
      container.querySelector('script, [onerror], a[href^="javascript:"]')
    ).toBeNull()
    expect(screen.getByText('Unsafe')).toBeVisible()
    expect(
      executor.output.value.data[markdownExecutorCapability.id].html
    ).toContain('<h1')
  })

  it('does not apply Markdown execution or syntax to other file types', async () => {
    const editor = registry
      .get(editorsService)
      .openEditor('notes.txt', '# Plain text')
    expect(editor.view.state.facet(language)).toBeNull()
    const executor = registry.get(executorsService).createExecutor(editor)
    await vi.waitFor(() => expect(executor.output.value.running).toBe(false))
    expect(executor.output.value.data).toEqual({})
  })

  it('handles loading, errors and empty output, cleaning up link handlers on remount', () => {
    const output = signal<ExecutorOutput>(
      createExecutorOutput({
        src: 'notes.md',
        contents: '',
        running: true,
      })
    )
    const editor = registry.get(editorsService).openEditor('notes.md', '')
    const { unmount } = render(
      <StrictMode>
        <MarkdownPreview
          executor={{
            ...registry.get(executorsService).createExecutor(editor),
            output,
          }}
        />
      </StrictMode>
    )
    expect(screen.getByRole('status')).toHaveTextContent('Rendering Markdown')
    act(() => {
      output.value = createExecutorOutput(
        { ...output.peek(), running: false },
        [[markdownExecutorCapability, new Error('Unable to render')]]
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to render')
    act(() => {
      output.value = createExecutorOutput(
        { ...output.peek(), running: false },
        [
          [
            markdownExecutorCapability,
            { html: '<a data-safe-link href="https://zoo.dev">Zoo</a>' },
          ],
        ]
      )
    })
    const link = screen.getByRole('link', { name: 'Zoo' })
    fireEvent.click(link)
    expect(links.open).toHaveBeenCalledOnce()
    unmount()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    click.preventDefault()
    fireEvent(link, click)
    expect(links.open).toHaveBeenCalledOnce()
  })
})
