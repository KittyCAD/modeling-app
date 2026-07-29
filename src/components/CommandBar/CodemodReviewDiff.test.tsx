import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CodemodReviewDiff } from '@src/components/CommandBar/CodemodReviewDiff'
import { Themes } from '@src/lib/theme'

vi.mock('@codemirror/merge', () => ({
  MergeView: class MergeView {
    dom: HTMLDivElement

    constructor({
      a,
      b,
      parent,
    }: {
      a: { doc: string }
      b: { doc: string }
      parent: Element
    }) {
      this.dom = document.createElement('div')
      this.dom.dataset.testid = 'mock-merge-view'
      this.dom.dataset.before = a.doc
      this.dom.dataset.after = b.doc
      parent.appendChild(this.dom)
    }

    destroy() {
      this.dom.remove()
    }
  },
}))

describe('CodemodReviewDiff', () => {
  it('shows the failed codemod diff on demand', () => {
    render(
      <CodemodReviewDiff
        details={{
          type: 'codemod',
          currentCode: 'part = extrude(sketch, length = 10)',
          proposedCode: 'part = extrude(sketch, length = -10)',
        }}
        resolvedTheme={Themes.Light}
      />
    )

    const toggle = screen.getByRole('button', { name: 'Codemod' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('cmd-bar-codemod-diff')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Current file')).toBeInTheDocument()
    expect(screen.getAllByText('Codemod')).toHaveLength(2)
    expect(screen.getByTestId('cmd-bar-codemod-diff')).toBeInTheDocument()
    expect(screen.getByTestId('mock-merge-view')).toHaveAttribute(
      'data-before',
      'part = extrude(sketch, length = 10)'
    )
    expect(screen.getByTestId('mock-merge-view')).toHaveAttribute(
      'data-after',
      'part = extrude(sketch, length = -10)'
    )

    fireEvent.click(toggle)
    expect(screen.queryByTestId('cmd-bar-codemod-diff')).not.toBeInTheDocument()
  })
})
