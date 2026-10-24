import type {
  Layout,
  LayoutAreaContribution,
  PaneLayout,
  PaneOpenBehavior,
  SplitLayout,
} from '@src/lib/layout/types'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import {
  applyLayoutContribution,
  applyPaneOpenBehavior,
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
const behaviors: PaneOpenBehavior[] = ['multiple', 'single']

function makePanes(
  specs: PaneSpec[],
  id = 'toolbar',
  behavior: PaneOpenBehavior = 'multiple'
): PaneLayout {
  const openIndices = specs.flatMap((spec, index) => (spec.open ? [index] : []))
  const activeIndices =
    behavior === 'single' ? openIndices.slice(0, 1) : openIndices
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
  it('normalizes nested panes without mutating input and is idempotent', () => {
    fc.assert(
      fc.property(
        paneSpecsArbitrary,
        paneSpecsArbitrary,
        (leftSpecs, nestedSpecs) => {
          const left = makePanes(leftSpecs, 'left')
          const nested = makePanes(nestedSpecs, 'nested')
          const outer = makePanes([{ open: true, weight: 1 }], 'outer')
          outer.children = [
            { ...withViewport(nested), id: 'nested-split', icon: 'code' },
          ]
          const root = withViewport(left)
          root.children[1] = outer
          const before = structuredClone(root)

          const normalized = applyPaneOpenBehavior(root, 'single')
          expect(root).toEqual(before)
          expect(applyPaneOpenBehavior(root, 'multiple')).toBe(root)
          expect(applyPaneOpenBehavior(normalized, 'single')).toBe(normalized)

          function compare(original: Layout, result: Layout) {
            expect(result.id).toBe(original.id)
            expect(result.type).toBe(original.type)
            if (
              original.type === LayoutType.Simple ||
              result.type === LayoutType.Simple
            ) {
              expect(result).toEqual(original)
              return
            }
            expect(result.children).toHaveLength(original.children.length)
            if (
              original.type === LayoutType.Panes &&
              result.type === LayoutType.Panes
            ) {
              expect(openIds(result)).toEqual(openIds(original).slice(0, 1))
              expectValidPaneState(result)
            } else {
              expect(result.sizes).toEqual(original.sizes)
            }
            original.children.forEach((child, index) =>
              compare(child, result.children[index])
            )
          }
          compare(root, normalized)
        }
      )
    )
  })

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

  it.each(behaviors)(
    'keeps contribution state valid in %s mode at every insertion position',
    (paneOpenBehavior) => {
      fc.assert(
        fc.property(
          paneSpecsArbitrary,
          fc.boolean(),
          (specs, initiallyOpen) => {
            // Multiple tabs may still be open immediately after the preference changes.
            for (let position = 0; position <= specs.length; position++) {
              const panes = makePanes(specs)
              const beforeIds = openIds(panes)
              const contribution = contributionAt(position, initiallyOpen)
              applyLayoutContribution({
                rootLayout: panes,
                contribution,
                config: { paneOpenBehavior },
              })

              expectValidPaneState(panes)
              const allowedIds = new Set([
                ...beforeIds,
                ...(initiallyOpen ? [contribution.pane.id] : []),
              ])
              const actualIds = openIds(panes)
              expect(actualIds.every((id) => allowedIds.has(id))).toBe(true)
              if (paneOpenBehavior === 'multiple') {
                expect(new Set(actualIds)).toEqual(allowedIds)
              } else {
                expect(actualIds).toHaveLength(allowedIds.size ? 1 : 0)
              }
            }
          }
        ),
        {
          // Pruning two open panes must give the survivor all of the space.
          // An open insertion at index zero also covers the falsy-index regression.
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
    }
  )

  it('prefers a newly opened pane by identity when normalizing after insertion', () => {
    fc.assert(
      fc.property(
        paneSpecsArbitrary,
        fc.nat({ max: 16 }),
        (specs, position) => {
          const previous = makePanes(specs)
          const next = structuredClone(previous)
          const contribution = contributionAt(
            position % (specs.length + 1),
            true
          )
          applyLayoutContribution({ rootLayout: next, contribution })
          const normalized = applyPaneOpenBehavior(next, 'single', previous)
          expect(openIds(normalized)).toEqual([contribution.pane.id])
          expectValidPaneState(normalized)
        }
      )
    )
  })

  it.each(behaviors)(
    'matches an ID-based model through toggle sequences in %s mode',
    (paneOpenBehavior) => {
      fc.assert(
        fc.property(
          nonemptyPaneSpecsArbitrary,
          fc.array(fc.nat({ max: 15 }), { minLength: 1, maxLength: 30 }),
          (specs, targets) => {
            const panes = makePanes(specs, 'toolbar', paneOpenBehavior)
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
                if (paneOpenBehavior === 'single') {
                  expected.clear()
                }
                expected.add(id)
              }
              togglePaneLayoutNode({
                rootLayout: root,
                targetNodeId: id,
                paneOpenBehavior,
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
    }
  )

  it.each(behaviors)(
    'treats explicit open/close requests as idempotent in %s mode',
    (paneOpenBehavior) => {
      fc.assert(
        fc.property(
          nonemptyPaneSpecsArbitrary,
          fc.nat({ max: 15 }),
          fc.boolean(),
          (specs, target, shouldExpand) => {
            const panes = makePanes(specs, 'toolbar', paneOpenBehavior)
            const root = withViewport(panes)
            const id = panes.children[target % specs.length].id
            const expected = new Set(openIds(panes))
            if (shouldExpand) {
              if (paneOpenBehavior === 'single') {
                expected.clear()
              }
              expected.add(id)
            } else {
              expected.delete(id)
            }
            const request = {
              rootLayout: root,
              targetNodeId: id,
              paneOpenBehavior,
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
    }
  )

  it.each(behaviors)(
    'collapses the last pane and restores its split width in %s mode',
    (paneOpenBehavior) => {
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
              paneOpenBehavior,
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
    }
  )
})
