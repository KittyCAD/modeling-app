import {
  MarkdownEditor,
  defaultNormalizeMarkdownLinkHref,
} from '@kittycad/ui-components'
import { render, screen, waitFor } from '@testing-library/react'
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
})
