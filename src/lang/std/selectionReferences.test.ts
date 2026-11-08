import { coerceSelectionsToBody as graphBodies } from '@src/lang/std/artifactGraph'
import { coerceSelectionsToBody as commandBodies } from '@src/lang/std/selectionCoercion'
import { expect, it } from 'vitest'
import fc from 'fast-check'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { createLocalName, createVariableDeclaration } from '@src/lang/create'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  resolveBodyReference,
  resolveNamedFaceReference,
  resolveFaceContainerReference,
} from '@src/lang/std/selectionReferences'

const wasm = {} as ModuleType
const program = (names: string[]) =>
  ({
    body: names.map((name) =>
      createVariableDeclaration(name, createLocalName('value'))
    ),
  }) as Node<Program>
const body = (variable: string, bodyId = 'body', indices: number[] = []) => ({
  variable,
  bodyId,
  artifactId: bodyId,
  indices,
  faceIds: ['face'],
  faces: [{ id: 'face', tag: 'right', sketch: true }],
})
it('does not choose arbitrarily between distinct owners of a face', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('first', 'one'), body('second', 'two')]
  expect(
    resolveNamedFaceReference('face', graph, program(['first', 'second']), wasm)
  ).toBeInstanceOf(Error)
})
it('uses an earlier public binding when a later alias is outside the edit scope', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('input'), body('later')]
  const end: PathToNode = [
    ['body', ''],
    [1, 'index'],
  ]
  expect(
    resolveBodyReference('body', graph, program(['input', 'later']), wasm, end)
  ).toMatchObject({ type: 'Name', name: { name: 'input' } })
})
it('prefers a direct public alias over an array containing the same body', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('target'), body('outputs', 'body', [2])]
  const reference = resolveNamedFaceReference(
    'face',
    graph,
    program(['target', 'outputs']),
    wasm
  )
  if (reference instanceof Error) throw reference
  expect(reference?.bodyExpr).toMatchObject({
    type: 'Name',
    name: { name: 'target' },
  })
})
it('retains each concrete output index rather than referencing its collection', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 1000 }), (index) => {
      const graph: ArtifactGraph = new Map()
      graph.bodyBindings = [body('outputs', 'body', [index])]
      expect(
        resolveBodyReference('body', graph, program(['outputs']), wasm)
      ).toMatchObject({
        type: 'MemberExpression',
        object: { type: 'Name', name: { name: 'outputs' } },
        property: { type: 'Literal', value: { value: index } },
        computed: true,
      })
    })
  )
})

it('follows an explicit single-body replacement', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('result', 'new')]
  graph.bodyReplacements = [
    { sourceId: 'old', sourceArtifactId: 'source', outputIds: ['new'] },
  ]
  expect(
    resolveBodyReference('source', graph, program(['result']), wasm)
  ).toMatchObject({ type: 'Name', name: { name: 'result' } })
})
it('requires an explicit choice when a consumed body has several outputs', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('parts', 'one', [0]), body('parts', 'two', [1])]
  graph.bodyReplacements = [
    { sourceId: 'old', sourceArtifactId: 'source', outputIds: ['one', 'two'] },
  ]
  expect(
    resolveBodyReference('source', graph, program(['parts']), wasm)
  ).toBeInstanceOf(Error)
  expect(
    resolveBodyReference('two', graph, program(['parts']), wasm)
  ).toMatchObject({
    type: 'MemberExpression',
    property: { type: 'Literal', value: { value: 1 } },
  })
})

it('does not render an alias removed from the current AST', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('live'), body('deleted')]
  expect(
    resolveBodyReference('body', graph, program(['live']), wasm)
  ).toMatchObject({ type: 'Name', name: { name: 'live' } })
})

it('does not hide an ambiguous owner when its public name is unavailable', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('visible', 'one'), body('deleted', 'two')]
  expect(
    resolveNamedFaceReference('face', graph, program(['visible']), wasm)
  ).toBeInstanceOf(Error)
})

it.each([graphBodies, commandBodies])(
  'coerces a named face to its runtime owner without requiring source artifacts',
  (coerce) => {
    const graph: ArtifactGraph = new Map()
    graph.bodyBindings = [body('outputs', 'live-output', [2])]
    expect(
      coerce(
        {
          graphSelections: [{ entityRef: { type: 'face', face_id: 'face' } }],
          otherSelections: [],
        },
        graph
      )
    ).toMatchObject({
      graphSelections: [
        { entityRef: { type: 'solid3d', solid3d_id: 'live-output' } },
      ],
    })
  }
)

it('retains a named tag path while using the latest alias of its physical body', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('first'), { ...body('latest'), faces: [] }]
  const ref = resolveNamedFaceReference(
    'face',
    graph,
    program(['first', 'latest']),
    wasm
  )
  if (ref instanceof Error) throw ref
  expect(ref?.bodyExpr).toMatchObject({
    type: 'Name',
    name: { name: 'latest' },
  })
  expect(ref?.faceExpr).toMatchObject({
    object: { object: { object: { name: { name: 'first' } } } },
  })
})
it('resolves an untagged face owner without claiming a named reference exists', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [{ ...body('target'), faces: [] }]
  expect(
    resolveNamedFaceReference('face', graph, program(['target']), wasm)
  ).toBeUndefined()
  expect(
    graphBodies(
      {
        graphSelections: [{ entityRef: { type: 'face', face_id: 'face' } }],
        otherSelections: [],
      },
      graph
    )
  ).toMatchObject({
    graphSelections: [{ entityRef: { type: 'solid3d', solid3d_id: 'body' } }],
  })
})

it('keeps the original tag binding when a later alias inherits the same tag', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [body('original'), body('merged')]
  const ref = resolveNamedFaceReference(
    'face',
    graph,
    program(['original', 'merged']),
    wasm
  )
  if (ref instanceof Error) throw ref
  expect(ref?.bodyExpr).toMatchObject({
    type: 'Name',
    name: { name: 'merged' },
  })
  expect(ref?.faceExpr).toMatchObject({
    object: { object: { object: { name: { name: 'original' } } } },
  })
})

it('materializes a tag through a binding that already contains that face', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [
    { ...body('base'), faceIds: ['old'], faces: [] },
    { ...body('treated'), faceIds: ['old', 'new'], faces: [] },
  ]
  const ast = program(['base', 'treated'])
  expect(resolveFaceContainerReference('old', graph, ast, wasm)).toMatchObject({
    type: 'Name',
    name: { name: 'base' },
  })
  expect(resolveFaceContainerReference('new', graph, ast, wasm)).toMatchObject({
    type: 'Name',
    name: { name: 'treated' },
  })
  expect(
    resolveFaceContainerReference('new', graph, ast, wasm, [
      ['body', ''],
      [1, 'index'],
    ])
  ).toBeUndefined()
})

it('uses the latest live body alias when selection carries an older semantic artifact ID', () => {
  const graph: ArtifactGraph = new Map()
  graph.bodyBindings = [
    { ...body('input', 'physical'), artifactId: 'input-feature' },
    { ...body('latest', 'physical'), artifactId: 'latest-feature' },
  ]
  expect(
    resolveBodyReference(
      'input-feature',
      graph,
      program(['input', 'latest']),
      wasm
    )
  ).toMatchObject({
    type: 'Name',
    name: { name: 'latest' },
  })
  expect(
    resolveBodyReference(
      'input-feature',
      graph,
      program(['input', 'latest']),
      wasm,
      [
        ['body', ''],
        [1, 'index'],
      ]
    )
  ).toMatchObject({
    type: 'Name',
    name: { name: 'input' },
  })
})
