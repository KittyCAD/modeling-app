import type { ModelingCmd } from '@kittycad/lib'
import type { Artifact, ArtifactGraph } from '@src/lang/wasm'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { useMeasurementSelection } from '@src/registry/extensions/engineScene/useMeasurementSelection'
import { act, renderHook } from '@testing-library/react'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

function selection(index: number): Selections {
  return {
    graphSelections: [
      {
        entityRef: { type: 'edge', side_faces: ['side-face'], index: 7 },
        engineTopologyFallback: { parentId: 'body', primitiveIndex: index },
      },
    ],
    otherSelections: [],
  }
}
function response(id: string) {
  return {
    success: true,
    resp: {
      type: 'modeling',
      data: {
        modeling_response: {
          type: 'solid3d_get_edge_uuid',
          data: { edge_id: id },
        },
      },
    },
  }
}
function controlledSender() {
  const pending: Array<(response: unknown) => void> = []
  const send = (cmd: ModelingCmd): Promise<unknown> => {
    expect(cmd.type).toBe('solid3d_get_edge_uuid')
    return new Promise((resolve) => pending.push(resolve))
  }
  return { send, pending }
}

describe('measurement selection request ownership', () => {
  it('only publishes the latest selection for generated completion orders, including A-B-A', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 2 }), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.array(fc.integer(), { minLength: 8, maxLength: 8 }),
        async (indices, priorities) => {
          const sender = controlledSender()
          const graph: ArtifactGraph = new Map()
          // Always include A-B-A; generated prefixes vary histories and queue sizes.
          const history = [...indices, 0, 1, 0].map(selection)
          const hook = renderHook(
            ({ selected }) =>
              useMeasurementSelection(selected, graph, sender.send, true),
            { initialProps: { selected: history[0] } }
          )
          try {
            for (const selected of history.slice(1)) hook.rerender({ selected })
            expect(sender.pending).toHaveLength(history.length)
            expect(hook.result.current.entities).toEqual([])
            const order = sender.pending
              .map((_, index) => index)
              .sort((a, b) => priorities[a % 8] - priorities[b % 8])
            let latestCompleted = false
            for (const index of order) {
              await act(async () =>
                sender.pending[index](response(`edge-request-${index}`))
              )
              if (index === history.length - 1) latestCompleted = true
              expect(hook.result.current.entities).toEqual(
                latestCompleted
                  ? [{ id: `edge-request-${history.length - 1}`, kind: 'edge' }]
                  : []
              )
            }
          } finally {
            hook.unmount()
          }
        }
      ),
      { numRuns: 40 }
    )
  })

  it('invalidates a pending resolution on graph replacement or leaving idle', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 0, max: 0xffffffff }),
        async (replaceGraph, index) => {
          const sender = controlledSender()
          const selected = selection(index)
          const graph: ArtifactGraph = new Map()
          const hook = renderHook(
            ({ graph, enabled }) =>
              useMeasurementSelection(selected, graph, sender.send, enabled),
            { initialProps: { graph, enabled: true } }
          )
          try {
            hook.rerender({
              graph: replaceGraph ? new Map<string, Artifact>() : graph,
              enabled: replaceGraph,
            })
            await act(async () => sender.pending[0](response('stale-edge')))
            expect(hook.result.current.entities).toEqual([])
            if (replaceGraph) {
              await act(async () => sender.pending[1](response('current-edge')))
              expect(hook.result.current.entities).toEqual([
                { id: 'current-edge', kind: 'edge' },
              ])
            }
          } finally {
            hook.unmount()
          }
        }
      ),
      { numRuns: 40 }
    )
  })

  it('stops issuing lookups after unmounting a multi-edge resolution', async () => {
    const sender = controlledSender()
    const first = selection(0)
    const second = selection(1)
    const hook = renderHook(() =>
      useMeasurementSelection(
        {
          graphSelections: [
            ...first.graphSelections,
            ...second.graphSelections,
          ],
          otherSelections: [],
        },
        new Map(),
        sender.send,
        true
      )
    )
    expect(sender.pending).toHaveLength(1)
    hook.unmount()
    await act(async () => sender.pending[0](response('old-edge')))
    expect(sender.pending).toHaveLength(1)
  })
})
