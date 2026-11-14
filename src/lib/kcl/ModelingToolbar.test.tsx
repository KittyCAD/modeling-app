import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { signal } from '@preact/signals-core'
import { ModelingToolbar } from '@src/lib/kcl/ModelingToolbar'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import { createModelingInteractions } from '@src/lib/kcl/interactions'
import { createSketchInteraction } from '@src/lib/kcl/sketch/definition'

it('shows shared sketch help and documentation before and after the button adapts to editing', async () => {
  const view = modelingTestContext()
  view.context.interactions.dispose()
  view.context.interactions = createModelingInteractions(
    () => view.context,
    signal([createSketchInteraction(signal([]))])
  )
  const mounted = render(<ModelingToolbar context={view.context} />)
  try {
    const start = screen.getByRole('button', { name: 'Start Sketch' })
    expect(start).toHaveAttribute(
      'aria-description',
      'Start drawing a 2D sketch.'
    )
    fireEvent.mouseOver(start)
    expect(screen.getByText('Start drawing a 2D sketch.')).toBeInTheDocument()
    expect(
      within(start.parentElement!).getByRole('link', {
        name: /Open KCL docs/,
        hidden: true,
      })
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/\/docs\/kcl-lang\/sketches$/)
    )
    await act(async () => {
      await view.resource.selection.pick({ clientX: 1, clientY: 0 })
    })
    const edit = screen.getByRole('button', { name: 'Edit Sketch' })
    expect(edit).toHaveAttribute(
      'aria-description',
      'Start drawing a 2D sketch.'
    )
    expect(
      within(start.parentElement!).getByRole('link', {
        name: /Open KCL docs/,
        hidden: true,
      })
    ).toHaveAttribute(
      'href',
      expect.stringMatching(/\/docs\/kcl-lang\/sketches$/)
    )
  } finally {
    mounted.unmount()
    view.dispose()
  }
})
