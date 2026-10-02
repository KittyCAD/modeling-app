import type {
  LayoutAreaContribution,
  PaneLayout,
  SplitLayout,
} from '@src/lib/layout/types'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  togglePaneLayoutNode,
} from '@src/lib/layout/utils'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

/**
 * Generate valid layouts by construction. Independent open flags and positive
 * weights cover empty selections, index zero, unequal sizes, and indices >= 10.
 * Small specifications also make fast-check's shrunk counterexamples readable.
 */
interface PaneSpec {
  open: boolean
  weight: number
}

const paneSpecArbitrary = fc.record({
  open: fc.boolean(),
  weight: fc.integer({ min: 1, max: 100 }),
})
const paneSpecsArbitrary = fc.array(paneSpecArbitrary, { maxLength: 16 })
const nonemptyPaneSpecsArbitrary = fc.array(paneSpecArbitrary, {
  minLength: 1,
  maxLength: 16,
})

function makePanes(specs: PaneSpec[], id = 'toolbar'): PaneLayout {
  const activeIndices = specs.flatMap((spec, index) =>
    spec.open ? [index] : []
  )
  const totalWeight = activeIndices.reduce(
    (sum, index) => sum + specs[index].weight,
    0
  )
  return {
    id,
    label: id,
    type: LayoutType.Panes,
    side: 'inline-start',
    splitOrientation: 'block',
    activeIndices,
    sizes: activeIndices.map(
      (index) => (100 * specs[index].weight) / totalWeight
    ),
    children: specs.map((_, index) => ({
      id: `${id}-${index}`,
      label: `Pane ${index}`,
      type: LayoutType.Simple,
      areaType: AreaType.Code,
      icon: 'code',
    })),
  }
}

function withViewport(panes: PaneLayout, width = 40): SplitLayout {
  const paneWidth = panes.activeIndices.length ? width : 0
  return {
    id: 'root',
    label: 'Root',
    type: LayoutType.Splits,
    orientation: 'inline',
    sizes: [paneWidth, 100 - paneWidth],
    children: [
      panes,
      {
        id: 'viewport',
        label: 'Viewport',
        type: LayoutType.Simple,
        areaType: AreaType.ModelingScene,
      },
    ],
  }
}

function openIds(panes: PaneLayout) {
  return panes.activeIndices.map((index) => panes.children[index].id)
}

function expectValidPaneState(panes: PaneLayout) {
  expect(panes.activeIndices).toEqual(
    [...new Set(panes.activeIndices)].sort((a, b) => a - b)
  )
  for (const index of panes.activeIndices) {
    expect(Number.isInteger(index)).toBe(true)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(panes.children.length)
  }
  expect(panes.sizes).toHaveLength(panes.activeIndices.length)
  for (const size of panes.sizes) {
    expect(Number.isFinite(size)).toBe(true)
    expect(size).toBeGreaterThan(0)
  }
  expect(panes.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(
    panes.activeIndices.length ? 100 : 0,
    8
  )
}

function contributionAt(
  index: number,
  initiallyOpen: boolean
): LayoutAreaContribution {
  return {
    id: 'contribution',
    kind: 'area',
    pane: {
      id: 'contributed-pane',
      label: 'Contributed pane',
      type: LayoutType.Simple,
      areaType: AreaType.Logs,
      icon: 'logs',
    },
    placement: { targetPaneId: 'toolbar', index },
    initiallyOpen,
  }
}

describe('layout properties', () => {
  it('preserves open pane identities and custom sizes when inserting a closed contribution', () => {
    fc.assert(
      fc.property(
        paneSpecsArbitrary,
        fc.nat({ max: 16 }),
        (specs, position) => {
          const panes = makePanes(specs)
          const before = structuredClone(panes)
          const contribution = contributionAt(
            position % (specs.length + 1),
            false
          )
          expect(
            applyLayoutContribution({ rootLayout: panes, contribution })
          ).toEqual({
            applied: true,
            reason: 'applied',
          })

          expect(openIds(panes)).toEqual(openIds(before))
          expect(panes.sizes).toEqual(before.sizes)
          expect(
            panes.children.filter((child) => child.id !== contribution.pane.id)
          ).toEqual(before.children)
          expectValidPaneState(panes)

          const after = structuredClone(panes)
          expect(
            applyLayoutContribution({ rootLayout: panes, contribution })
          ).toEqual({
            applied: false,
            reason: 'already-present',
          })
          expect(panes).toEqual(after)
        }
      )
    )
  })

  it('keeps contribution state valid at every insertion position', () => {
    fc.assert(
      fc.property(paneSpecsArbitrary, fc.boolean(), (specs, initiallyOpen) => {
        for (let position = 0; position <= specs.length; position++) {
          const panes = makePanes(specs)
          const beforeIds = openIds(panes)
          const contribution = contributionAt(position, initiallyOpen)
          applyLayoutContribution({
            rootLayout: panes,
            contribution,
          })

          expectValidPaneState(panes)
          const allowedIds = new Set([
            ...beforeIds,
            ...(initiallyOpen ? [contribution.pane.id] : []),
          ])
          const actualIds = openIds(panes)
          expect(actualIds.every((id) => allowedIds.has(id))).toBe(true)
          expect(new Set(actualIds)).toEqual(allowedIds)
        }
      }),
      {
        examples: [
          [
            [
              { open: true, weight: 1 },
              { open: true, weight: 1 },
            ],
            false,
          ],
          [
            [
              { open: true, weight: 1 },
              { open: true, weight: 1 },
            ],
            true,
          ],
        ],
      }
    )
  })

  it('matches an ID-based model through toggle sequences', () => {
    fc.assert(
      fc.property(
        nonemptyPaneSpecsArbitrary,
        fc.array(fc.nat({ max: 15 }), { minLength: 1, maxLength: 30 }),
        (specs, targets) => {
          const panes = makePanes(specs)
          const root = withViewport(panes)
          const childrenBefore = structuredClone(panes.children)
          const viewportBefore = structuredClone(root.children[1])
          // The oracle stores IDs, independently of the implementation's indices and sizes.
          const expected = new Set(openIds(panes))
          for (const target of targets) {
            const id = panes.children[target % specs.length].id
            if (expected.has(id)) {
              expected.delete(id)
            } else {
              expected.add(id)
            }
            togglePaneLayoutNode({
              rootLayout: root,
              targetNodeId: id,
            })
            expectValidPaneState(panes)
            expect(new Set(openIds(panes))).toEqual(expected)
            expect(panes.children).toEqual(childrenBefore)
            expect(root.children[1]).toEqual(viewportBefore)
          }
        }
      ),
      {
        examples: [
          [
            Array.from({ length: 11 }, (_, index) => ({
              open: index === 10,
              weight: 1,
            })),
            [2],
          ],
        ],
      }
    )
  })

  it('treats explicit open/close requests as idempotent', () => {
    fc.assert(
      fc.property(
        nonemptyPaneSpecsArbitrary,
        fc.nat({ max: 15 }),
        fc.boolean(),
        (specs, target, shouldExpand) => {
          const panes = makePanes(specs)
          const root = withViewport(panes)
          const id = panes.children[target % specs.length].id
          const expected = new Set(openIds(panes))
          if (shouldExpand) {
            expected.add(id)
          } else {
            expected.delete(id)
          }
          const request = {
            rootLayout: root,
            targetNodeId: id,
            shouldExpand,
          }
          togglePaneLayoutNode(request)
          expectValidPaneState(panes)
          expect(new Set(openIds(panes))).toEqual(expected)
          const after = structuredClone(root)
          togglePaneLayoutNode(request)
          expect(root).toEqual(after)
        }
      ),
      {
        examples: [
          [[{ open: false, weight: 1 }], 0, true],
          [[{ open: false, weight: 1 }], 0, false],
          [
            [
              { open: true, weight: 1 },
              { open: false, weight: 1 },
            ],
            1,
            false,
          ],
        ],
      }
    )
  })

  it('collapses the last pane and restores its split width', () => {
    fc.assert(
      // Widths <= 10 intentionally use the utility's fallback expansion size.
      fc.property(
        fc.integer({ min: 11, max: 90 }),
        fc.constantFrom<SplitLayout['orientation']>('inline', 'block'),
        fc.boolean(),
        (width, orientation, atEnd) => {
          const panes = makePanes([{ open: true, weight: 1 }])
          const root = withViewport(panes, width)
          root.orientation = orientation
          panes.side = `${orientation}-${atEnd ? 'end' : 'start'}`
          if (atEnd) {
            root.children.reverse()
            root.sizes.reverse()
          }
          const originalSizes = [...root.sizes]
          const request = {
            rootLayout: root,
            targetNodeId: panes.children[0].id,
          }
          togglePaneLayoutNode(request)
          expect(panes.activeIndices).toEqual([])
          expect(root.sizes).toEqual(atEnd ? [100, 0] : [0, 100])
          togglePaneLayoutNode(request)
          expectValidPaneState(panes)
          expect(openIds(panes)).toEqual([panes.children[0].id])
          expect(root.sizes).toEqual(originalSizes)
        }
      )
    )
  })
})
