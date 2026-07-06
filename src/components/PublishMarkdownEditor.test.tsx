import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  PublishMarkdownEditor,
  normalizePublishMarkdownLinkHref,
} from '@src/components/PublishMarkdownEditor'

describe('PublishMarkdownEditor', () => {
  it('renders supported Markdown formatting and strips unsafe Markdown links', async () => {
    render(
      <PublishMarkdownEditor
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

    const editor = await screen.findByTestId(
      'publish-project-description-editor'
    )

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
    expect(normalizePublishMarkdownLinkHref('zoo.dev/docs')).toBe(
      'https://zoo.dev/docs'
    )
    expect(normalizePublishMarkdownLinkHref('https://zoo.dev')).toBe(
      'https://zoo.dev/'
    )
    expect(normalizePublishMarkdownLinkHref('mailto:hello@zoo.dev')).toBe(
      'mailto:hello@zoo.dev'
    )
    expect(normalizePublishMarkdownLinkHref('javascript:alert(1)')).toBeNull()
    expect(normalizePublishMarkdownLinkHref('data:text/html,test')).toBeNull()
  })
})
