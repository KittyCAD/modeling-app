import type { Artifact, ArtifactGraph, CodeRef } from '@src/lang/wasm'
import type {
  Selection,
  SetSelections,
} from '@src/machines/modelingSharedTypes'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const graphSelections: Selection[] = []
  return {
    send: vi.fn<
      (
        event:
          | {
              type: 'Set selection'
              data: SetSelections
            }
          | { type: 'Center camera on selection' }
      ) => void
    >(),
    legacySelection: vi.fn(),
    graphSelections,
    manager: { code: ' '.repeat(200), ast: {}, artifactGraph: new Map() },
  }
})
vi.mock('@src/lib/boot', () => ({
  useSingletons: () => ({ kclManager: state.manager }),
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => ({
    actor: {},
    send: state.send,
    context: {
      selectionRanges: {
        graphSelections: state.graphSelections,
        otherSelections: [],
      },
    },
  }),
}))
vi.mock('@src/lib/featureTree', () => ({
  sendSelectionEvent: state.legacySelection,
}))
vi.mock('@src/lib/operations', () => ({
  getHideOpByArtifactId: vi.fn(),
  onDelete: vi.fn(),
  onHide: vi.fn(),
  onUnhide: vi.fn(),
}))
import { BodyItem } from '@src/lib/featureTree/BodiesPane'
import {
  onDelete,
  onHide,
  onUnhide,
  type HideOperation,
} from '@src/lib/operations'

const codeRef: CodeRef = {
  range: [10, 20, 0],
  nodePath: { steps: [] },
  pathToNode: [],
}
function sweep(
  id = 'sweep',
  pathId = 'path'
): Extract<Artifact, { type: 'sweep' }> {
  return {
    type: 'sweep',
    id,
    subType: 'extrusion',
    pathId,
    surfaceIds: [],
    edgeIds: [],
    codeRef,
    trajectoryId: null,
    method: 'new',
    consumed: false,
  }
}
function linkedPath(
  body: Extract<Artifact, { type: 'sweep' }>
): Extract<Artifact, { type: 'path' }> {
  return {
    type: 'path',
    id: body.pathId ?? 'path',
    subType: 'region',
    planeId: 'xy',
    segIds: [],
    consumed: true,
    sweepId: body.id,
    trajectorySweepId: null,
    codeRef,
  }
}
function graph(...artifacts: Artifact[]): ArtifactGraph {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]))
}
function clickBody(name = 'Body 1'): Selection {
  fireEvent.click(screen.getByRole('button', { name }))
  expect(state.send).toHaveBeenCalledOnce()
  const event = state.send.mock.calls[0][0]
  expect(event.type).toBe('Set selection')
  if (
    event.type !== 'Set selection' ||
    event.data.selectionType !== 'singleCodeCursor'
  ) {
    throw new Error('Expected a single body selection')
  }
  expect(event.data.selectionType).toBe('singleCodeCursor')
  return event.data.selection
}
beforeEach(() => {
  vi.clearAllMocks()
  state.graphSelections.length = 0
  state.manager.code = ' '.repeat(200)
})

describe('body row scene selection', () => {
  it('preserves a multiselection on right-click and explicitly targets Center on body', () => {
    const body = sweep()
    state.graphSelections.push(
      { entityRef: { type: 'solid3d', solid3d_id: 'path' } },
      { entityRef: { type: 'solid3d', solid3d_id: 'other-body' } }
    )
    render(
      <BodyItem
        label="Body 1"
        artifact={body}
        artifactGraph={graph(body, linkedPath(body))}
      />
    )
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Body 1', pressed: true })
    )
    expect(state.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Center on body' }))
    expect(state.send.mock.calls.map(([event]) => event)).toEqual([
      {
        type: 'Set selection',
        data: {
          selectionType: 'completeSelection',
          selection: {
            graphSelections: [
              expect.objectContaining({ engineEntityId: 'path' }),
            ],
            otherSelections: [],
          },
        },
      },
      { type: 'Center camera on selection' },
    ])
  })

  it('uses the same body for the eye and context-menu Hide, then Delete', () => {
    const body = sweep()
    render(
      <BodyItem
        label="Body 1"
        artifact={body}
        artifactGraph={graph(body, linkedPath(body))}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hide Body 1' }))
    expect(state.send).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Body 1' }))
    expect(state.send).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Hide body' }))
    const hiddenObjects = vi.mocked(onHide).mock.calls[0][0].objects
    expect(vi.mocked(onHide).mock.calls[1][0].objects).toEqual(hiddenObjects)
    expect(hiddenObjects?.graphSelections[0].engineEntityId).toBe('path')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Body 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete body' }))
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ objects: hiddenObjects })
    )
  })

  it('offers Show for a hidden body and no actions for a disabled body', () => {
    const body = sweep()
    const hideOperation = { type: 'StdLibCall', name: 'hide' } as HideOperation
    vi.mocked(onUnhide).mockResolvedValue(undefined)
    const { rerender } = render(
      <BodyItem
        label="Body 1"
        artifact={body}
        artifactGraph={graph(body)}
        hideOperation={hideOperation}
      />
    )
    expect(screen.getByRole('button', { name: 'Show Body 1' })).toBeEnabled()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Body 1' }))
    expect(
      screen.getByRole('button', { name: 'Center on body' })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Show body' }))
    expect(onUnhide).toHaveBeenCalledWith({
      hideOperation,
      targetArtifact: body,
      kclManager: state.manager,
    })
    state.send.mockClear()
    rerender(
      <BodyItem
        label="Body 1"
        artifact={body}
        artifactGraph={graph(body)}
        disabled
      />
    )
    const row = screen.getByRole('button', { name: 'Body 1' })
    fireEvent.click(row)
    fireEvent.contextMenu(row)
    expect(row).toBeDisabled()
    expect(state.send).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Center on body' })).toBeNull()
    expect(screen.queryByTestId('feature-tree-visibility-toggle')).toBeNull()
  })

  it('selects a whole swept body by engine ID instead of reselecting its code range', () => {
    const body = sweep()
    render(
      <BodyItem
        label="Body 1"
        artifact={body}
        artifactGraph={graph(body, linkedPath(body))}
      />
    )
    const selection = clickBody()
    expect(selection.artifact).toBe(body)
    expect(selection.entityRef).toEqual({ type: 'solid3d', solid3d_id: 'path' })
    expect(selection.engineEntityId).toBe('path')
    expect(state.legacySelection).not.toHaveBeenCalled()
  })

  const subTypes: Extract<Artifact, { type: 'sweep' }>['subType'][] = [
    'loft',
    'blend',
  ]
  it.each(subTypes)(
    'selects a %s by its own ID rather than its base sketch',
    (subType) => {
      const body = { ...sweep(), subType }
      render(
        <BodyItem
          label="Body 1"
          artifact={body}
          artifactGraph={graph(body, linkedPath(body))}
        />
      )
      expect(clickBody().entityRef).toEqual({
        type: 'solid3d',
        solid3d_id: body.id,
      })
    }
  )

  it('selects a Boolean result by its own engine ID', () => {
    const body: Extract<Artifact, { type: 'compositeSolid' }> = {
      type: 'compositeSolid',
      id: 'boolean',
      subType: 'union',
      consumed: false,
      solidIds: [],
      toolIds: [],
      codeRef,
    }
    render(
      <BodyItem label="Body 1" artifact={body} artifactGraph={graph(body)} />
    )
    expect(clickBody().entityRef).toEqual({
      type: 'solid3d',
      solid3d_id: body.id,
    })
  })

  it('selects a mirrored body without highlighting its source body', () => {
    const source = sweep('source')
    const mirror = sweep('mirror')
    render(
      <BodyItem
        label="Body 1"
        artifact={mirror}
        artifactGraph={graph(source, linkedPath(source), mirror)}
      />
    )
    expect(clickBody().entityRef).toEqual({
      type: 'solid3d',
      solid3d_id: 'mirror',
    })
  })

  it('distinguishes imported bodies that share the same import code reference', () => {
    const first = sweep('first', 'first-path')
    const second = sweep('second', 'second-path')
    const artifactGraph = graph(
      first,
      linkedPath(first),
      second,
      linkedPath(second)
    )
    state.graphSelections.push({
      entityRef: { type: 'solid3d', solid3d_id: 'first-path' },
    })
    render(
      <>
        <BodyItem
          label="Body 1"
          artifact={first}
          artifactGraph={artifactGraph}
        />
        <BodyItem
          label="Body 2"
          artifact={second}
          artifactGraph={artifactGraph}
        />
      </>
    )
    expect(
      screen.getByRole('button', { name: 'Body 1' }).parentElement
    ).toHaveClass('bg-primary/25')
    expect(
      screen.getByRole('button', { name: 'Body 2' }).parentElement
    ).not.toHaveClass('bg-primary/25')
    const selection = clickBody('Body 2')
    expect(selection.artifact).toBe(second)
    expect(selection.entityRef).toEqual({
      type: 'solid3d',
      solid3d_id: 'second-path',
    })
  })

  it('preserves explicit pattern-copy identity', () => {
    const pattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'pattern',
      sourceId: 'source',
      subType: 'linear',
      copyIds: ['copy'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef,
    }
    render(
      <BodyItem
        label="Body 1"
        artifact={pattern}
        artifactGraph={graph(pattern)}
        engineEntityId="copy"
        patternIndex={1}
      />
    )
    const selection = clickBody()
    expect(selection.artifact).toBe(pattern)
    expect(selection.patternIndex).toBe(1)
    expect(selection.entityRef).toEqual({ type: 'solid3d', solid3d_id: 'copy' })
  })

  it('retains UTF-16 code navigation and module identity with non-ASCII text', () => {
    const prefix = '// \u{1F600}\n'
    state.manager.code = prefix + ' '.repeat(100)
    const start = new TextEncoder().encode(prefix).length
    const body = {
      ...sweep(),
      codeRef: {
        ...codeRef,
        range: [start, start + 10, 9] satisfies CodeRef['range'],
      },
    }
    render(
      <BodyItem label="Body 1" artifact={body} artifactGraph={graph(body)} />
    )
    expect(clickBody().codeRef?.range).toEqual([
      prefix.length,
      prefix.length + 10,
      9,
    ])
  })
})
