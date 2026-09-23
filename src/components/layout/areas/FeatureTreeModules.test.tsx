import {
  FeatureTreeModule,
  FeatureTreeModules,
  useRevealFeatureTreeModule,
} from '@src/components/layout/areas/FeatureTreeModules'
import type { OperationTree } from '@src/lib/featureTreeOperationTree'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const tree: OperationTree = {
  nodes: [],
  getChildren: () => [],
  getModuleAncestors: (moduleId) => (moduleId === 2 ? [1, 2] : [moduleId]),
}

function Reference() {
  const reveal = useRevealFeatureTreeModule()
  return <button onClick={() => reveal?.(2)}>Shared module reference</button>
}

function fixture(value = 'Original operation', executionGeneration = 0) {
  const children = vi.fn(() => <span>{value}</span>)
  const parentChildren = vi.fn(() => (
    <FeatureTreeModule moduleId={2} name="Nested" heading="Nested">
      {children}
    </FeatureTreeModule>
  ))
  return {
    children,
    parentChildren,
    element: (
      <FeatureTreeModules tree={tree} executionGeneration={executionGeneration}>
        <FeatureTreeModule moduleId={1} name="Parent" heading="Parent">
          {parentChildren}
        </FeatureTreeModule>
        <FeatureTreeModule moduleId={3} name="Sibling" heading="Sibling">
          {() => <span>Sibling operation</span>}
        </FeatureTreeModule>
        <Reference />
      </FeatureTreeModules>
    ),
  }
}

describe('feature tree module expansion', () => {
  it('does not build collapsed contents, and expands one level at a time', () => {
    const example = fixture()
    render(example.element)

    expect(example.parentChildren).not.toHaveBeenCalled()
    expect(example.children).not.toHaveBeenCalled()
    expect(screen.queryByText('Nested')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Parent' }))
    expect(screen.getByText('Nested')).toBeVisible()
    expect(example.children).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Nested' }))
    expect(screen.getByText('Original operation')).toBeVisible()
    expect(screen.queryByText('Sibling operation')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Parent' }))
    expect(screen.queryByText('Original operation')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Parent' }))
    expect(screen.getByText('Original operation')).toBeVisible()
  })

  it('retains choices through live updates and completion without opening other modules', () => {
    const { rerender } = render(fixture('Original operation', 1).element)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Parent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Nested' }))

    rerender(fixture('Updated operation', 1).element)
    expect(screen.getByText('Updated operation')).toBeVisible()
    expect(screen.queryByText('Original operation')).toBeNull()

    rerender(fixture('Final operation', 1).element)
    expect(screen.getByText('Final operation')).toBeVisible()
    expect(screen.queryByText('Sibling operation')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Parent' }))
    rerender(fixture('New snapshot', 1).element)
    expect(screen.queryByText('New snapshot')).toBeNull()
  })

  it('resets expansion for a new execution whose module IDs may be reused', () => {
    const { rerender } = render(fixture().element)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Parent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Nested' }))

    const next = fixture('Different module', 1)
    rerender(next.element)
    expect(next.parentChildren).not.toHaveBeenCalled()
    expect(next.children).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Expand Parent' })).toBeVisible()
  })

  it('reveals a duplicate reference through collapsed ancestors', () => {
    render(fixture().element)
    fireEvent.click(
      screen.getByRole('button', { name: 'Shared module reference' })
    )
    expect(
      screen.getByRole('button', { name: 'Collapse Parent' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Collapse Nested' })
    ).toBeVisible()
    expect(screen.getByText('Original operation')).toBeVisible()
    expect(screen.queryByText('Sibling operation')).toBeNull()
  })
})
