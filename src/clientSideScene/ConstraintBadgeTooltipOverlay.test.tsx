import { ConstraintBadgeTooltipOverlay } from '@src/clientSideScene/ConstraintBadgeTooltipOverlay'
import {
  TOOLTIP_RICH_CONTENT_CLEAR_DELAY_MS,
  TOOLTIP_RICH_CONTENT_DELAY_MS,
} from '@src/hooks/useRichTooltipContent'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const objects = Array.from({ length: 22 })
  const firstConstraint = {
    id: 20,
    kind: {
      type: 'Constraint',
      constraint: { type: 'Parallel', lines: [1, 2] },
    },
  }
  const secondConstraint = {
    id: 21,
    kind: {
      type: 'Constraint',
      constraint: { type: 'Parallel', lines: [3, 4] },
    },
  }
  objects[20] = firstConstraint
  objects[21] = secondConstraint

  const makeSnapshot = (hoveredId: number | null) => ({
    context: {
      hoveredId,
      sketchId: 'sketch001',
      sketchExecOutcome: {
        sceneGraphDelta: { new_graph: { objects } },
      },
    },
  })

  return {
    snapshot: makeSnapshot(20),
    firstConstraint,
    secondConstraint,
  }
})

vi.mock('@xstate/react', () => ({
  useSelector: (_actor: unknown, selector: (snapshot: unknown) => unknown) =>
    selector(mocks.snapshot),
}))

vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    state: { children: { sketchSolveMachine: {} } },
  }),
}))

function TestScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <div ref={containerRef} data-testid="scene" />
      <ConstraintBadgeTooltipOverlay containerRef={containerRef} />
    </>
  )
}

function makeRect({
  left,
  top,
  width,
  height,
}: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

describe('ConstraintBadgeTooltipOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.snapshot.context.hoveredId = 20
    mocks.firstConstraint.kind.constraint.type = 'Parallel'
    mocks.secondConstraint.kind.constraint.type = 'Parallel'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.testid === 'scene') {
          return makeRect({ left: 100, top: 50, width: 400, height: 300 })
        }
        return this.dataset.variant === 'rich'
          ? makeRect({ left: 0, top: 0, width: 160, height: 80 })
          : makeRect({ left: 0, top: 0, width: 80, height: 40 })
      }
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the name immediately and expands after the toolbar delay', () => {
    render(<TestScene />)

    fireEvent.mouseMove(screen.getByTestId('scene'), {
      clientX: 200,
      clientY: 120,
      buttons: 0,
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Parallel')
    expect(tooltip).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    expect(tooltip).toHaveClass('w-max')
    expect(tooltip).toHaveClass('pointer-events-none')
    expect(tooltip).toHaveStyle({
      left: '208px',
      top: '128px',
      visibility: 'visible',
    })

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS - 1)
    })
    expect(tooltip).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(tooltip).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    expect(tooltip).toHaveClass('w-72')
  })

  it('follows the pointer and hides during pointer actions', () => {
    render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '208px' })

    fireEvent.mouseMove(scene, { clientX: 250, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '258px' })

    fireEvent.mouseDown(scene)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseUp(scene, { clientX: 250, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '258px' })
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    fireEvent.mouseLeave(scene)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('cancels a pending expansion when the actor hover leaves', () => {
    const { rerender } = render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS - 1)
    })
    mocks.snapshot.context.hoveredId = null
    rerender(<TestScene />)

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    mocks.snapshot.context.hoveredId = 20
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS - 1)
    })
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
  })

  it('restarts a pending expansion when the hovered badge changes', () => {
    const { rerender } = render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS - 1)
    })

    mocks.snapshot.context.hoveredId = 21
    rerender(<TestScene />)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS - 2)
    })
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
  })

  it('matches the toolbar rich-content grace period between hovers', () => {
    const { rerender } = render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    mocks.snapshot.context.hoveredId = 21
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    mocks.snapshot.context.hoveredId = null
    rerender(<TestScene />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_CLEAR_DELAY_MS - 1)
    })
    mocks.snapshot.context.hoveredId = 20
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    mocks.snapshot.context.hoveredId = null
    rerender(<TestScene />)
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_CLEAR_DELAY_MS)
    })
    mocks.snapshot.context.hoveredId = 20
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
  })

  it('repositions on expansion and distinguishes a click from a drag', () => {
    render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 490, clientY: 340, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({
      left: '402px',
      top: '292px',
    })

    act(() => {
      vi.advanceTimersByTime(TOOLTIP_RICH_CONTENT_DELAY_MS)
    })
    expect(screen.getByRole('tooltip')).toHaveStyle({
      left: '322px',
      top: '252px',
    })

    fireEvent.mouseDown(scene, { clientX: 490, clientY: 340, buttons: 1 })
    fireEvent.mouseMove(scene, { clientX: 300, clientY: 200, buttons: 1 })
    fireEvent.mouseUp(scene, { clientX: 300, clientY: 200, buttons: 0 })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseMove(scene, { clientX: 490, clientY: 340, buttons: 0 })
    fireEvent.mouseDown(scene, { clientX: 490, clientY: 340, buttons: 1 })
    fireEvent.mouseMove(scene, { clientX: 494, clientY: 343, buttons: 1 })
    fireEvent.mouseUp(scene, { clientX: 494, clientY: 343, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Parallel')
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
  })
})
