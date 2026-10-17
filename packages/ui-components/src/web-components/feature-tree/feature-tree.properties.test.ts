import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { registerFeatureTree, type ZooFeatureTree } from './feature-tree'
import type { ZooFeatureTreeRow } from '../feature-tree-row/feature-tree-row'

registerFeatureTree()

/** Flat records keep the oracle independent from the component's recursive DOM traversal. */
interface Node {
  id: string
  parent: string | null
  disabled: boolean
}

const nodeSpec = fc.record({
  parent: fc.nat(12),
  disabled: fc.boolean(),
  expanded: fc.boolean(),
})
const operation = fc.record({
  kind: fc.constantFrom(
    'insert',
    'remove',
    'reorder',
    'expand',
    'disable',
    'select-state',
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Enter',
    ' '
  ),
  target: fc.nat(30),
})

async function settle(tree: ZooFeatureTree) {
  // A structure mutation can schedule a row render, which in turn changes slots.
  for (let pass = 0; pass < 3; pass++) {
    await tree.updateComplete
    await Promise.all(
      [...tree.querySelectorAll('zoo-feature-tree-row')].map(
        (row) => row.updateComplete
      )
    )
    await Promise.resolve()
  }
}

function key(row: ZooFeatureTreeRow, value: string) {
  row.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  )
}

describe('feature tree generated histories', () => {
  it('matches a flat hierarchy model through mutations and controlled keyboard requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(nodeSpec, { maxLength: 9 }),
        fc.array(operation, { maxLength: 35 }),
        fc.boolean(),
        fc.boolean(),
        async (initial, operations, rtl, allowDisabled) => {
          const tree = document.createElement('zoo-feature-tree')
          tree.style.direction = rtl ? 'rtl' : 'ltr'
          const rows = new Map<string, ZooFeatureTreeRow>()
          let nodes: Node[] = []
          let expanded: string[] = []
          let selected: string[] = []
          let active: string | undefined
          let hasDisabledFocusQuirk =
            allowDisabled && initial.some((spec) => spec.disabled)
          let nextId = 0
          const selections: unknown[] = []
          const expansions: unknown[] = []
          tree.addEventListener('zoo-selection-change', (event) =>
            selections.push((event as CustomEvent).detail)
          )
          tree.addEventListener('zoo-expand', (event) =>
            expansions.push((event as CustomEvent).detail)
          )

          const ancestors = (node: Node): Node[] => {
            const result: Node[] = []
            let parent = node.parent
            while (parent !== null) {
              const ancestor = nodes.find(
                (candidate) => candidate.id === parent
              )!
              result.unshift(ancestor)
              parent = ancestor.parent
            }
            return result
          }
          const siblings = (node: Node) =>
            nodes.filter((candidate) => candidate.parent === node.parent)
          const children = (node: Node) =>
            nodes.filter((candidate) => candidate.parent === node.id)
          const visible = () =>
            nodes
              .filter((node) =>
                ancestors(node).every((ancestor) =>
                  expanded.includes(ancestor.id)
                )
              )
              .sort((left, right) => {
                const leftPath = [...ancestors(left), left]
                const rightPath = [...ancestors(right), right]
                for (
                  let index = 0;
                  index < Math.min(leftPath.length, rightPath.length);
                  index++
                ) {
                  if (leftPath[index].id !== rightPath[index].id)
                    return (
                      nodes.indexOf(leftPath[index]) -
                      nodes.indexOf(rightPath[index])
                    )
                }
                return leftPath.length - rightPath.length
              })
          const insert = (parent: string | null, disabled: boolean) => {
            const node: Node = {
              id: `node-${nextId++}`,
              parent,
              disabled: allowDisabled && disabled,
            }
            nodes.push(node)
            const row = document.createElement('zoo-feature-tree-row')
            row.nodeId = node.id
            row.label = `Feature ${node.id}`
            row.disabled = node.disabled
            if (parent !== null) row.slot = 'children'
            rows.set(node.id, row)
            ;(parent === null ? tree : rows.get(parent)!).append(row)
            return node
          }
          const recover = (previousAncestors: string[]) => {
            const shown = visible()
            if (!shown.some((node) => node.id === active))
              active =
                previousAncestors.find((id) =>
                  shown.some((node) => node.id === id)
                ) ??
                shown.find((node) => selected.includes(node.id))?.id ??
                shown[0]?.id
          }
          const check = () => {
            const shown = visible()
            const tabStops = [...tree.querySelectorAll('zoo-feature-tree-row')]
              .filter((row) => row.tabIndex === 0)
              .map((row) => row.nodeId)
            expect(tabStops).toEqual(active === undefined ? [] : [active])
            expect(tree.tabIndex).toBe(shown.length ? -1 : 0)
            for (const node of nodes) {
              const row = rows.get(node.id)!
              expect(row.getAttribute('aria-level')).toBe(
                String(ancestors(node).length + 1)
              )
              expect(row.getAttribute('aria-posinset')).toBe(
                String(siblings(node).indexOf(node) + 1)
              )
              expect(row.getAttribute('aria-setsize')).toBe(
                String(siblings(node).length)
              )
              expect(row.getAttribute('aria-expanded')).toBe(
                children(node).length
                  ? String(expanded.includes(node.id))
                  : null
              )
              expect(row.getAttribute('aria-selected')).toBe(
                String(selected.includes(node.id))
              )
              expect(row.getAttribute('aria-disabled')).toBe(
                String(node.disabled)
              )
            }
            expect(tree.selectedIds).toBe(selected)
            expect(tree.expandedIds).toBe(expanded)
            // happy-dom treats `disabled` on custom elements as native disabled,
            // so real-browser tests cover exact focus when navigating disabled rows.
            const focused = document.activeElement as ZooFeatureTreeRow | null
            if (
              !hasDisabledFocusQuirk &&
              focused?.localName === 'zoo-feature-tree-row'
            )
              expect(shown.some((node) => node.id === focused.nodeId)).toBe(
                true
              )
          }

          try {
            for (const spec of initial) {
              const parent = spec.parent % (nodes.length + 1)
              const node = insert(
                parent === nodes.length ? null : nodes[parent].id,
                spec.disabled
              )
              if (spec.expanded) expanded.push(node.id)
            }
            tree.expandedIds = expanded
            tree.selectedIds = selected
            document.body.append(tree)
            await settle(tree)
            active = visible()[0]?.id
            ;(active === undefined ? tree : rows.get(active)!).focus()
            check()

            for (const step of operations) {
              const target = nodes[step.target % nodes.length]
              const oldAncestors =
                active === undefined
                  ? []
                  : ancestors(nodes.find((node) => node.id === active)!)
                      .reverse()
                      .map((node) => node.id)
              selections.length = 0
              expansions.length = 0
              let expectedSelection: unknown[] = []
              let expectedExpansion: unknown[] = []
              // Browser tests cover moving focused subtrees; happy-dom exposes
              // intermediate detachment synchronously during these DOM moves.
              const canReorder =
                target &&
                target.id !== active &&
                !nodes.some(
                  (node) =>
                    node.id === active && ancestors(node).includes(target)
                )

              if (step.kind === 'insert') {
                insert(
                  step.target % 2 === 0 && target ? target.id : null,
                  false
                )
              } else if (step.kind === 'remove' && target) {
                const removed = nodes.filter(
                  (node) => node === target || ancestors(node).includes(target)
                )
                rows.get(target.id)!.remove()
                nodes = nodes.filter((node) => !removed.includes(node))
              } else if (step.kind === 'reorder' && target && canReorder) {
                const first = siblings(target)[0]
                if (first !== target) {
                  nodes = nodes.filter((node) => node !== target)
                  nodes.splice(nodes.indexOf(first), 0, target)
                }
                const row = rows.get(target.id)!
                row.parentElement!.prepend(row)
              } else if (step.kind === 'expand' && target) {
                expanded = expanded.includes(target.id)
                  ? expanded.filter((id) => id !== target.id)
                  : [...expanded, target.id]
                tree.expandedIds = expanded
              } else if (step.kind === 'disable' && target) {
                target.disabled = allowDisabled && !target.disabled
                hasDisabledFocusQuirk ||= target.disabled
                rows.get(target.id)!.disabled = target.disabled
              } else if (step.kind === 'select-state') {
                selected = target ? [target.id] : []
                tree.selectedIds = selected
              } else if (
                active !== undefined &&
                !['remove', 'reorder', 'expand', 'disable'].includes(step.kind)
              ) {
                const shown = visible()
                const index = shown.findIndex((node) => node.id === active)
                const current = shown[index]
                const logicalKey =
                  rtl && step.kind === 'ArrowLeft'
                    ? 'ArrowRight'
                    : rtl && step.kind === 'ArrowRight'
                      ? 'ArrowLeft'
                      : step.kind
                let next = current
                if (logicalKey === 'ArrowDown')
                  next = shown[Math.min(index + 1, shown.length - 1)]
                if (logicalKey === 'ArrowUp')
                  next = shown[Math.max(index - 1, 0)]
                if (logicalKey === 'Home') next = shown[0]
                if (logicalKey === 'End') next = shown[shown.length - 1]
                if (logicalKey === 'ArrowRight' && children(current).length) {
                  if (expanded.includes(current.id)) next = children(current)[0]
                  else if (!current.disabled)
                    expectedExpansion = [{ nodeId: current.id, expanded: true }]
                }
                if (logicalKey === 'ArrowLeft') {
                  if (
                    children(current).length &&
                    expanded.includes(current.id)
                  ) {
                    if (!current.disabled)
                      expectedExpansion = [
                        { nodeId: current.id, expanded: false },
                      ]
                  } else if (current.parent !== null)
                    next = nodes.find((node) => node.id === current.parent)!
                }
                if (
                  (logicalKey === 'Enter' || logicalKey === ' ') &&
                  !current.disabled
                )
                  expectedSelection = [
                    { nodeId: current.id, selectedIds: [current.id] },
                  ]
                rows.get(active)!.focus()
                key(rows.get(active)!, step.kind)
                active = next.id
              }
              recover(oldAncestors)
              await settle(tree)
              expect(selections).toEqual(expectedSelection)
              expect(expansions).toEqual(expectedExpansion)
              check()
            }
          } finally {
            tree.remove()
            await settle(tree)
          }
        }
      ),
      { numRuns: 60 }
    )
  }, 30_000)
})
