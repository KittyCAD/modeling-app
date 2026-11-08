import { EditorState } from '@codemirror/state'
import { expect, it } from 'vitest'
import {
  readDot,
  positionChanges,
  checkedChanges,
  insertStatement,
  type Point,
} from '@src/lib/dot/document'
import { executeDot } from '@src/lib/dot/executor'

function document(source: string) {
  const result = readDot(source)
  if (result instanceof Error) throw result
  return result
}
function move(source: string, positions: Map<string, Point>) {
  const changes = checkedChanges(
    source,
    positionChanges(source, document(source), positions)
  )
  if (changes instanceof Error) throw changes
  return EditorState.create({ doc: source })
    .update({ changes })
    .state.doc.toString()
}

it('persists implicit and quoted nodes without rewriting comments, subgraphs, or unrelated attributes', () => {
  const source = `digraph G {
  // Keep this comment and the exact label spelling.
  subgraph cluster_test { "a b" [label="A", color=red]; }
  "a b" -> c [label="edge"];
}`
  const positions = new Map([
    ['a b', { x: 120, y: -80 }],
    ['c', { x: -50, y: 30 }],
  ])
  const updated = move(source, positions)
  expect(updated).toContain(
    '// Keep this comment and the exact label spelling.'
  )
  expect(updated).toContain(
    'subgraph cluster_test { "a b" [label="A", color=red'
  )
  expect(updated).toContain('"a b" -> c [label="edge"];')
  expect(document(updated).positions).toEqual(positions)
  const again = move(
    updated,
    new Map([
      ['a b', { x: 130, y: -80 }],
      ['c', { x: -50, y: 30 }],
    ])
  )
  expect(again).toBe(updated.replace('120,80!', '130,80!'))
})

it('retains the drawn coordinates through repeated execution and uses DOT inches before the first position edit', async () => {
  const source =
    'digraph { a [pos="1,2!"]; b [pos="3,4!"]; a [color=red]; a -> b; }'
  const initial = await executeDot(source)
  if (initial instanceof Error) throw initial
  expect(
    Object.values(initial.graph.nodes).map((node) => [
      node.name,
      node.x,
      node.y,
    ])
  ).toEqual([
    ['a', 72, -144],
    ['b', 216, -288],
  ])
  const positions = new Map(
    Object.values(initial.graph.nodes).map((node) => [
      node.name,
      { x: node.x + 27, y: node.y - 31 },
    ])
  )
  const updated = move(source, positions)
  for (let i = 0; i < 2; i++) {
    const run = await executeDot(updated)
    if (run instanceof Error) throw run
    expect(
      new Map(
        Object.values(run.graph.nodes).map((node) => [
          node.name,
          { x: node.x, y: node.y },
        ])
      )
    ).toEqual(positions)
  }
})

it('locates reconnectable endpoints while preserving labels, ports, and graph kind', async () => {
  const source = 'graph { a:port -- "b b" [label="keep"]; c; }'
  const result = await executeDot(source)
  if (result instanceof Error) throw result
  const edge = Object.values(result.graph.edges)[0]
  expect(result.graph.directed).toBe(false)
  expect(edge.source).toBeDefined()
  const changed = EditorState.create({ doc: source })
    .update({ changes: { ...edge.source!.to, insert: 'c' } })
    .state.doc.toString()
  expect(changed).toBe('graph { a:port -- c [label="keep"]; c; }')
  expect(await executeDot(changed)).not.toBeInstanceOf(Error)
  const withConnection = EditorState.create({ doc: changed })
    .update({ changes: insertStatement(changed, document(changed), 'c -- a;') })
    .state.doc.toString()
  expect(await executeDot(withConnection)).not.toBeInstanceOf(Error)
})

it('surfaces malformed DOT and leaves edge-chain reconnection to source editing', async () => {
  expect(await executeDot('digraph { a -> }')).toBeInstanceOf(Error)
  const result = await executeDot('digraph { a -> b -> c; }')
  if (result instanceof Error) throw result
  expect(
    Object.values(result.graph.edges).every((edge) => edge.source === undefined)
  ).toBe(true)
})
