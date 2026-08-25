import { ConstraintBadgeTooltipOverlay } from '@src/clientSideScene/ConstraintBadgeTooltipOverlay'
import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const objects = Array.from({ length: 21 })
  objects[20] = {
    id: 20,
    kind: {
      type: 'Constraint',
      constraint: { type: 'Parallel', lines: [1, 2] },
    },
  }

  return {
    snapshot: {
      context: {
        hoveredId: 20,
        sketchId: 'sketch001',
        sketchExecOutcome: {
          sceneGraphDelta: { new_graph: { objects } },
        },
      },
    },
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
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === 'scene'
          ? makeRect({ left: 100, top: 50, width: 400, height: 300 })
          : makeRect({ left: 0, top: 0, width: 160, height: 80 })
      }
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the expanded tooltip immediately on canvas hover', () => {
    render(<TestScene />)

    fireEvent.mouseMove(screen.getByTestId('scene'), {
      clientX: 200,
      clientY: 120,
      buttons: 0,
    })

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Parallel')
    expect(tooltip).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    expect(tooltip).toHaveClass('pointer-events-none')
    expect(tooltip).toHaveStyle({
      left: '208px',
      top: '128px',
      visibility: 'visible',
    })
  })

  it('follows the hovered badge instance and hides during pointer actions', () => {
    render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '208px' })

    fireEvent.mouseMove(scene, { clientX: 250, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveStyle({ left: '258px' })

    fireEvent.mouseDown(scene)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseMove(scene, { clientX: 250, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.mouseLeave(scene)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
