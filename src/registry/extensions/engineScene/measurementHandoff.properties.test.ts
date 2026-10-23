import type { ModelingCmd } from '@kittycad/lib'
import type { Artifact } from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { getMeasurementTarget } from '@src/registry/extensions/engineScene/measurementCapabilities'
import * as handoff from '@src/registry/extensions/engineScene/measurementUtils'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

const options = { numRuns: 150 }
const edgeArbitrary = fc
  .tuple(
    fc.uniqueArray(fc.uuid(), { minLength: 4, maxLength: 4 }),
    fc.integer({ min: 0, max: 0xffffffff }),
    fc.integer({ min: 0, max: 8 })
  )
  .map(([ids, index, referenceIndex]) => ({
    id: ids[0],
    parent: ids[1],
    side: ids[2],
    cap: ids[3],
    index,
    referenceIndex,
  }))
const emptyGraph = new Map<string, Artifact>()
function selections(graphSelections: Selection[]): Selections {
  return { graphSelections, otherSelections: [] }
}
function edgeReference(
  edge: {
    id: string
    parent: string
    side: string
    cap: string
    index: number
    referenceIndex: number
  },
  rawId: boolean
): Selection {
  return {
    entityRef: {
      type: 'edge',
      side_faces: [edge.side],
      end_faces: [edge.cap],
      index: edge.referenceIndex,
    },
    engineTopologyFallback: {
      parentId: edge.parent,
      primitiveIndex: edge.index,
    },
    ...(rawId ? { engineEntityId: edge.id } : {}),
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

// Generate logical edges independently of their selection representations.
// UUID expectations come from the generated edge, never an artifact lookup.
describe('selection-to-measurement representation properties', () => {
  it('preserves an edge across raw Face API and engine primitive representations', () => {
    fc.assert(
      fc.property(edgeArbitrary, (edge) => {
        const expected = [{ id: edge.id, kind: 'edge' }]
        const legacy: Selections = {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: edge.id,
              parentEntityId: edge.parent,
              primitiveIndex: edge.index,
              primitiveType: 'edge',
            },
          ],
        }
        expect(handoff.getMeasurementEntities(legacy)).toEqual(expected)
        const actual = handoff.getMeasurementEntities(
          selections([edgeReference(edge, true)])
        )
        expect(actual).toEqual(expected)
        expect(getMeasurementTarget(actual)?.type).toBe('edgeLength')
      }),
      options
    )
  })

  it('does not substitute a lineage face for an explicitly selected edge', () => {
    fc.assert(
      fc.property(edgeArbitrary, (edge) => {
        const locator: Extract<Artifact, { type: 'wall' }> = {
          type: 'wall',
          id: edge.side,
          segId: 'segment',
          sweepId: edge.parent,
          edgeCutEdgeIds: [],
          pathIds: [],
          cmdId: 'command',
          faceCodeRef: {
            range: [0, 0, 0],
            pathToNode: [],
            nodePath: { steps: [] },
          },
        }
        const selection = { ...edgeReference(edge, true), artifact: locator }
        expect(handoff.getMeasurementEntities(selections([selection]))).toEqual(
          [{ id: edge.id, kind: 'edge' }]
        )
      }),
      options
    )
  })

  it('uses UUID-bearing references without requiring legacy artifacts', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.constantFrom('face', 'solid3d', 'solid2d_edge', 'segment'),
        (id, type) => {
          const selection: Selection =
            type === 'face'
              ? { entityRef: { type, face_id: id } }
              : type === 'solid3d'
                ? { entityRef: { type, solid3d_id: id } }
                : type === 'solid2d_edge'
                  ? { entityRef: { type, edge_id: id } }
                  : {
                      entityRef: {
                        type: 'segment',
                        path_id: 'path',
                        segment_id: id,
                      },
                    }
          expect(
            handoff.getMeasurementEntities(selections([selection]))
          ).toEqual([
            {
              id,
              kind:
                type === 'face' ? 'face' : type === 'solid3d' ? 'body' : 'edge',
            },
          ])
        }
      ),
      options
    )
  })

  it('preserves distinct edges and deduplicates them independently of order', () => {
    fc.assert(
      fc.property(
        fc.array(edgeArbitrary, { minLength: 1, maxLength: 8 }),
        (edges) => {
          const rows = edges.map((edge) => edgeReference(edge, true))
          const expected = [...new Set(edges.map((edge) => edge.id))].sort()
          for (const input of [rows, [...rows].reverse(), [...rows, ...rows]]) {
            const actual = handoff.getMeasurementEntities(selections(input))
            expect(actual.map((entity) => entity.id).sort()).toEqual(expected)
            expect(actual.every((entity) => entity.kind === 'edge')).toBe(true)
            expect(getMeasurementTarget(actual)?.type ?? null).toBe(
              expected.length === 1
                ? 'edgeLength'
                : expected.length === 2
                  ? 'distance'
                  : null
            )
          }
        }
      ),
      options
    )
  })
})

describe('topology edge resolution properties', () => {
  it('resolves the owning body/index to the exact edge UUID', async () => {
    await fc.assert(
      fc.asyncProperty(edgeArbitrary, async (edge) => {
        const commands: ModelingCmd[] = []
        const result = await handoff.resolveMeasurementEntities(
          selections([edgeReference(edge, false)]),
          emptyGraph,
          async (cmd) => {
            commands.push(cmd)
            return response(edge.id)
          }
        )
        expect(commands).toEqual([
          {
            type: 'solid3d_get_edge_uuid',
            object_id: edge.parent,
            edge_index: edge.index,
          },
        ])
        expect(result).toEqual([{ id: edge.id, kind: 'edge' }])
      }),
      options
    )
  })

  it('preserves raw picked UUIDs without topology lookups', async () => {
    await fc.assert(
      fc.asyncProperty(edgeArbitrary, async (edge) => {
        const result = await handoff.resolveMeasurementEntities(
          selections([edgeReference(edge, true)]),
          emptyGraph,
          async () => {
            expect.fail('Raw picked UUIDs must not be re-resolved')
          }
        )
        expect(result).toEqual([{ id: edge.id, kind: 'edge' }])
      }),
      options
    )
  })

  it('resolves duplicate and reordered references to the same entity set', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(edgeArbitrary, {
          minLength: 1,
          maxLength: 5,
          selector: (edge) => `${edge.parent}:${edge.index}`,
        }),
        async (edges) => {
          const byLocator = new Map(
            edges.map((edge) => [`${edge.parent}:${edge.index}`, edge.id])
          )
          const rows = edges.map((edge) => edgeReference(edge, false))
          for (const input of [rows, [...rows].reverse(), [...rows, ...rows]]) {
            const result = await handoff.resolveMeasurementEntities(
              selections(input),
              emptyGraph,
              async (cmd) => {
                expect(cmd.type).toBe('solid3d_get_edge_uuid')
                if (cmd.type !== 'solid3d_get_edge_uuid')
                  return new Error('Wrong resolver command')
                const id = byLocator.get(`${cmd.object_id}:${cmd.edge_index}`)
                expect(id).toBeDefined()
                return response(id ?? '')
              }
            )
            expect(result).not.toBeInstanceOf(Error)
            if (result instanceof Error) return
            expect(result.map((entity) => entity.id).sort()).toEqual(
              [...new Set(edges.map((edge) => edge.id))].sort()
            )
            expect(result.every((entity) => entity.kind === 'edge')).toBe(true)
          }
        }
      ),
      options
    )
  })

  it('fails the whole handoff instead of dropping one unresolved edge', async () => {
    await fc.assert(
      fc.asyncProperty(
        edgeArbitrary,
        fc.constantFrom('error', 'malformed', 'reject'),
        async (edge, failure) => {
          const result = await handoff.resolveMeasurementEntities(
            selections([
              {
                entityRef: { type: 'edge', side_faces: ['first-face'] },
                engineEntityId: 'first-edge',
              },
              edgeReference(edge, false),
            ]),
            emptyGraph,
            () =>
              failure === 'reject'
                ? Promise.reject(new Error('Lookup failed'))
                : Promise.resolve(
                    failure === 'error'
                      ? new Error('Lookup failed')
                      : response('')
                  )
          )
          expect(result).toBeInstanceOf(Error)
        }
      ),
      options
    )
  })

  it('does not invent an edge index when topology is absent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (faceId) => {
        const result = await handoff.resolveMeasurementEntities(
          selections([{ entityRef: { type: 'edge', side_faces: [faceId] } }]),
          emptyGraph,
          async () => {
            expect.fail('An edge without a locator must not trigger a lookup')
          }
        )
        expect(result).toBeInstanceOf(Error)
      }),
      options
    )
  })
})
