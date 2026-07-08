import {
  defaultNormalizeMarkdownLinkHref,
  MarkdownEditor,
  type MarkdownEditorActions,
  normalizeMarkdownEditorValue,
} from '@kittycad/ui-components'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

describe('MarkdownEditor', () => {
  it('renders supported Markdown formatting and strips unsafe Markdown links', async () => {
    render(
      <MarkdownEditor
        id="description"
        value={[
          'A **bold** project with [Zoo](zoo.dev).',
          '',
          '- First point',
          '- Second point',
          '',
          '[Unsafe](javascript:alert(1))',
        ].join('\n')}
        onChange={vi.fn()}
      />
    )

    const editor = await screen.findByTestId('markdown-editor')

    await waitFor(() => {
      expect(editor).toHaveTextContent('A bold project with Zoo.')
    })

    expect(editor.querySelector('strong')).toHaveTextContent('bold')
    expect(
      editor.querySelector('a[href="https://zoo.dev/"]')
    ).toHaveTextContent('Zoo')
    expect(editor.querySelectorAll('li')).toHaveLength(2)
    expect(editor).toHaveTextContent('Unsafe')
    expect(editor.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('normalizes user-entered link URLs to safe hrefs', () => {
    expect(defaultNormalizeMarkdownLinkHref('zoo.dev/docs')).toBe(
      'https://zoo.dev/docs'
    )
    expect(defaultNormalizeMarkdownLinkHref('https://zoo.dev')).toBe(
      'https://zoo.dev/'
    )
    expect(defaultNormalizeMarkdownLinkHref('mailto:hello@zoo.dev')).toBe(
      'mailto:hello@zoo.dev'
    )
    expect(defaultNormalizeMarkdownLinkHref('javascript:alert(1)')).toBeNull()
    expect(defaultNormalizeMarkdownLinkHref('data:text/html,test')).toBeNull()
  })

  it('normalizes Markdown content with the same safe link policy', () => {
    expect(
      normalizeMarkdownEditorValue(
        'A [safe](zoo.dev/docs) link and an [unsafe](javascript:alert(1)) link.'
      )
    ).toBe('A [safe](https://zoo.dev/docs) link and an unsafe link.')
  })

  it('sets required and described-by accessibility attributes', async () => {
    render(
      <MarkdownEditor
        id="description"
        value=""
        onChange={vi.fn()}
        required={true}
        describedBy="description-error"
      />
    )

    const editor = await screen.findByTestId('markdown-editor')
    expect(editor).toHaveAttribute('aria-required', 'true')
    expect(editor).toHaveAttribute('aria-describedby', 'description-error')
  })

  it('uses the toolbar to insert normalized links', async () => {
    const onChange = vi.fn()
    Object.defineProperty(window, 'prompt', {
      configurable: true,
      value: vi.fn(() => 'zoo.dev/docs'),
    })

    render(<MarkdownEditor id="description" value="" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      '[https://zoo.dev/docs](https://zoo.dev/docs)'
    )
  })

  it('exposes a link action for external keymap integrations', async () => {
    const onChange = vi.fn()
    const actionsRef: { current: MarkdownEditorActions | null } = {
      current: null,
    }

    render(
      <MarkdownEditor
        id="description"
        value=""
        onChange={onChange}
        onActionsChange={(nextActions) => {
          actionsRef.current = nextActions
        }}
        promptForLink={() => 'zoo.dev/docs'}
      />
    )

    await waitFor(() => {
      expect(actionsRef.current).not.toBeNull()
    })

    const actions = actionsRef.current
    if (!actions) {
      throw new Error('Missing Markdown editor actions')
    }

    expect(actions.setLink()).toBe(true)
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled()
    })
    expect(onChange.mock.calls.at(-1)?.[0]).toContain(
      '[https://zoo.dev/docs](https://zoo.dev/docs)'
    )
  })
})
