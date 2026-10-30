import type { BodyItem } from '@rust/kcl-lib/bindings/BodyItem'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { FeatureHistoryControls } from '@src/lib/featureTree/FeatureHistoryControls'
import {
  getFeatureHistory,
  ROLLBACK_CODE,
} from '@src/lib/featureTree/featureHistory'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

function node<T>(value: T, start: number, end: number): Node<T> {
  return { ...value, start, end, moduleId: 0, commentStart: start }
}

function variable(name: string, start: number): BodyItem {
  return node(
    {
      type: 'VariableDeclaration',
      kind: 'const',
      declaration: node(
        {
          type: 'VariableDeclarator',
          id: node({ type: 'Identifier', name }, start, start + 1),
          init: node(
            { type: 'Literal', raw: '1', value: { value: 1, suffix: 'None' } },
            start + 4,
            start + 5
          ),
        },
        start,
        start + 5
      ),
    },
    start,
    start + 5
  )
}

function history(code = 'a = 1\nb = 1\n') {
  return getFeatureHistory(
    node(
      { type: 'Program', body: [variable('a', 0), variable('b', 6)] },
      0,
      code.length
    ),
    code
  )
}

function measureBoundaries(offset = 0) {
  return [0, 1, 2].map((index) =>
    vi
      .spyOn(
        screen.getByTestId(`feature-tree-boundary-${index}`),
        'getBoundingClientRect'
      )
      .mockReturnValue(new DOMRect(0, offset + index * 60, 200, 12))
  )
}

function dragAt(
  type: 'dragover' | 'drop',
  element: Element,
  clientY: number,
  dataTransfer: object
) {
  // Happy DOM's DragEvent omits mouse coordinates, unlike browser DragEvents.
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
  })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  fireEvent(element, event)
}

describe('feature history controls', () => {
  it('moves the rollback bar by keyboard and announces the boundary', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    const bar = screen.getByRole('slider', { name: 'Rollback bar' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    fireEvent.keyDown(bar, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('a = 1\n' + ROLLBACK_CODE + 'b = 1\n')
  })

  it('drags a feature block and leaves operation contents separate from the handle', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => <span>{block.label}</span>}
      />
    )
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('button', { name: 'Move b' }), {
      dataTransfer,
    })
    fireEvent.drop(screen.getByTestId('feature-tree-boundary-0'), {
      dataTransfer,
    })
    expect(onChange).toHaveBeenCalledWith('b = 1\na = 1\n')
  })

  it('ignores a drag if the source changes before the drop', () => {
    const onChange = vi.fn()
    const props = {
      disabled: false,
      onChange,
      renderBlock: (block: { label: string }) => block.label,
    }
    const view = render(
      <FeatureHistoryControls {...props} history={history()} />
    )
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('button', { name: 'Move b' }), {
      dataTransfer,
    })
    view.rerender(
      <FeatureHistoryControls {...props} history={history('a = 2\nb = 1\n')} />
    )
    fireEvent.drop(screen.getByTestId('feature-tree-boundary-0'), {
      dataTransfer,
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables rollback and dragging while execution or editing makes the tree read-only', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    expect(screen.getByRole('button', { name: 'Move a' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('snaps a rollback dropped on feature content to the closest gap', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => <span>{block.label}</span>}
      />
    )
    measureBoundaries()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('slider'), { dataTransfer })
    dragAt('dragover', screen.getByText('a'), 45, dataTransfer)
    expect(screen.getByTestId('feature-tree-boundary-1')).toContainElement(
      screen.getByTestId('feature-tree-drop-indicator')
    )
    dragAt('drop', screen.getByText('a'), 45, dataTransfer)
    expect(onChange).toHaveBeenCalledWith('a = 1\n' + ROLLBACK_CODE + 'b = 1\n')
  })

  it('snaps to the first gap when released above the feature rows', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    measureBoundaries()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('slider'), { dataTransfer })
    dragAt(
      'drop',
      screen.getByTestId('feature-tree-history'),
      -50,
      dataTransfer
    )
    expect(onChange).toHaveBeenCalledWith(ROLLBACK_CODE + 'a = 1\nb = 1\n')
  })

  it('accepts the blank space below the last feature as the final gap', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={{ ...history(), rollbackIndex: 0 }}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => block.label}
      />
    )
    measureBoundaries()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('slider'), { dataTransfer })
    dragAt(
      'dragover',
      screen.getByTestId('feature-tree-history'),
      500,
      dataTransfer
    )
    expect(screen.getByTestId('feature-tree-boundary-2')).toContainElement(
      screen.getByTestId('feature-tree-drop-indicator')
    )
    dragAt(
      'drop',
      screen.getByTestId('feature-tree-history'),
      500,
      dataTransfer
    )
    expect(onChange).toHaveBeenCalledWith('a = 1\nb = 1\n')
  })

  it('uses the current row positions at release instead of a stale hover target', () => {
    const onChange = vi.fn()
    render(
      <FeatureHistoryControls
        history={history()}
        disabled={false}
        onChange={onChange}
        renderBlock={(block) => <span>{block.label}</span>}
      />
    )
    const measurements = measureBoundaries()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    fireEvent.dragStart(screen.getByRole('slider'), { dataTransfer })
    dragAt('dragover', screen.getByText('a'), 45, dataTransfer)
    measurements.forEach((measurement, index) =>
      measurement.mockReturnValue(new DOMRect(0, 30 + index * 60, 200, 12))
    )
    dragAt('drop', screen.getByText('a'), 45, dataTransfer)
    expect(onChange).toHaveBeenCalledWith(ROLLBACK_CODE + 'a = 1\nb = 1\n')
  })
})
