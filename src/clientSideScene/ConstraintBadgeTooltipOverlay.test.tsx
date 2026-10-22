import { ConstraintBadgeTooltipOverlay } from '@src/clientSideScene/ConstraintBadgeTooltipOverlay'
import * as TooltipModule from '@src/components/Tooltip'
import { fireEvent, render, screen } from '@testing-library/react'
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

vi.mock('@src/components/Tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof TooltipModule>()
  const { forwardRef } = await import('react')

  return {
    ...actual,
    TooltipSurface: forwardRef<
      HTMLDivElement,
      React.ComponentPropsWithoutRef<'div'>
    >(function MockTooltipSurface({ children, ...props }, ref) {
      return (
        <div ref={ref} {...props} data-testid="shared-tooltip-surface">
          {children}
        </div>
      )
    }),
  }
})

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
    vi.restoreAllMocks()
  })

  it('shows the constraint name and rich description immediately', () => {
    render(<TestScene />)

    fireEvent.mouseMove(screen.getByTestId('scene'), {
      clientX: 200,
      clientY: 120,
      buttons: 0,
    })

    const tooltip = screen.getByRole('tooltip')
    const surface = screen.getByTestId('shared-tooltip-surface')
    expect(tooltip).toContainElement(surface)
    expect(tooltip).toHaveTextContent('Parallel')
    expect(tooltip).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    expect(tooltip).toHaveAttribute('data-variant', 'rich')
    expect(tooltip).toHaveClass('pointer-events-none')
    expect(tooltip).toHaveStyle({
      left: '208px',
      top: '128px',
      visibility: 'visible',
    })

    expect(surface).toHaveClass(
      ...TooltipModule.RICH_TOOLTIP_SURFACE_CLASS_NAME.split(' ')
    )
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
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )

    fireEvent.mouseLeave(scene)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('hides when the actor hover leaves and immediately restores rich content', () => {
    const { rerender } = render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    mocks.snapshot.context.hoveredId = null
    rerender(<TestScene />)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    mocks.snapshot.context.hoveredId = 20
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
  })

  it('immediately updates the description when the hovered badge changes', () => {
    const { rerender } = render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 200, clientY: 120, buttons: 0 })
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    mocks.secondConstraint.kind.constraint.type = 'Perpendicular'
    mocks.snapshot.context.hoveredId = 21
    rerender(<TestScene />)
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(
      'Constrain lines or curves to be parallel.'
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Constrain lines or curves to be perpendicular.'
    )
    expect(screen.getByRole('tooltip')).toHaveAttribute('data-variant', 'rich')
  })

  it('positions rich content within the scene and distinguishes a click from a drag', () => {
    render(<TestScene />)
    const scene = screen.getByTestId('scene')

    fireEvent.mouseMove(scene, { clientX: 490, clientY: 340, buttons: 0 })
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
