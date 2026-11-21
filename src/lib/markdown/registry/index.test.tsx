import { requireSuccess, codeSurface } from '@src/lib/editors/testViews'
import { matchesEditor } from '@src/lib/editors/matching'
import { editorViewsFacet } from '@src/lib/editors/registry/contract'
import '@src/lib/projectSession/next/testFeature'
import { language } from '@codemirror/language'
import { Registry, contribute } from 'plankton'
import { signal } from '@preact/signals-core'
import editorsExtension from '@src/lib/editors/registry'
import {
  editorsService,
  codeEditorsExtensionFacet,
} from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { createExecutorOutput } from '@src/lib/executors/output'
import {
  executorsService,
  executorCapabilityFacet,
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
  beforeEach(async () => {
    links.open.mockClear()
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      executorsExtension,
      markdownExtension,
    ])
  })
  afterEach(async () => {
    cleanup()
    await registry.dispose()
  })

  it('contributes editing, execution and a preview from one extension without depending on either service', async () => {
    const isolated = new Registry()
    try {
      await isolated.configure([markdownExtension])
      const syntax = isolated
        .get(codeEditorsExtensionFacet)
        .find(({ id }) => id === 'editors.markdown')!
      expect(
        matchesEditor(syntax.matches, {
          src: '',
          contents: '# Untitled',
          languageId: 'markdown',
          mediaType: 'text/markdown',
        })
      ).toBe(true)
      expect(isolated.get(executorCapabilityFacet)).toEqual([
        markdownExecutorCapability,
      ])
      expect(isolated.get(editorViewsFacet)).toEqual([
        expect.objectContaining({
          id: 'markdown.preview',
        }),
      ])
      const preview = isolated.get(editorViewsFacet)[0]
      expect(
        matchesEditor(preview.matches, {
          src: '/notes.md',
          contents: '# Text',
          backing: 'text',
        })
      ).toBe(true)
      expect(
        matchesEditor(preview.matches, {
          src: '/notes.md',
          contents: '',
          backing: 'binary',
        })
      ).toBe(false)
      expect(isolated.optional(editorsService)).toBeUndefined()
      expect(isolated.optional(executorsService)).toBeUndefined()
    } finally {
      await isolated.dispose()
    }
  })

  it('highlights Markdown and executes its contents as a live preview', async () => {
    const editor = requireSuccess(
      registry
        .required(editorsService)
        .openEditor('/README.MD', '# Hello\n\n[Zoo](https://zoo.dev)')
    )
    expect(
      codeSurface(registry.required(editorsService), editor).state.facet(
        language
      )?.name
    ).toBe('markdown')
    const executor = requireSuccess(
      registry.required(executorsService).acquireExecutor(editor)
    ).executor
    render(<MarkdownPreview executor={executor} />)
    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeVisible()
    const link = screen.getByRole('link', { name: 'Zoo' })
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(link)
    expect(links.open).toHaveBeenCalledWith('https://zoo.dev/')
    act(() => {
      editor.dispatch({
        changes: {
          from: 0,
          to: editor.state.doc.length,
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

  it('shows completed Markdown while another capability is still running', async () => {
    const pending = Promise.withResolvers<{ text: string }>()
    const slow = vi.fn(() => pending.promise)
    await registry.configure([
      editorsExtension,
      executorsExtension,
      markdownExtension,
      contribute(executorCapabilityFacet, () => ({
        id: 'slow-analysis',
        matches: '.md' as const,
        execute: slow,
      })),
    ])
    const editor = requireSuccess(
      registry.required(editorsService).openEditor('notes.md', '# Ready')
    )
    const executor = requireSuccess(
      registry.required(executorsService).acquireExecutor(editor)
    ).executor
    try {
      render(<MarkdownPreview executor={executor} />)
      expect(
        await screen.findByRole('heading', { name: 'Ready' })
      ).toBeVisible()
      expect(slow).toHaveBeenCalledOnce()
      expect(executor.output.value.running).toBe(true)
      expect(
        screen.getByRole('article', { name: 'Markdown preview' })
      ).toHaveAttribute('aria-busy', 'false')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await act(async () => {
        pending.resolve({ text: 'done' })
      })
      await vi.waitFor(() => expect(executor.output.value.running).toBe(false))
      expect(screen.getByRole('heading', { name: 'Ready' })).toBeVisible()
    } finally {
      pending.resolve({ text: 'done' })
    }
  })

  it('uses the existing renderer to escape raw HTML and reject executable links', async () => {
    const editor = requireSuccess(
      registry
        .required(editorsService)
        .openEditor(
          'unsafe.md',
          '# Preview\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>'
        )
    )
    const executor = requireSuccess(
      registry.required(executorsService).acquireExecutor(editor)
    ).executor
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

  it('handles loading, errors and empty output, cleaning up link handlers on remount', async () => {
    const output = signal<ExecutorOutput>(
      createExecutorOutput({
        src: 'notes.md',
        contents: '',
        running: true,
      })
    )
    const editor = requireSuccess(
      registry.required(editorsService).openEditor('notes.md', '')
    )
    const { unmount } = render(
      <StrictMode>
        <MarkdownPreview
          executor={{
            ...requireSuccess(
              registry.required(executorsService).acquireExecutor(editor)
            ).executor,
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
