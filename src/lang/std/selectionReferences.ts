import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createLiteral,
  createLocalName,
  createMemberExpression,
} from '@src/lang/create'
import type { ArtifactGraph, Expr, PathToNode, Program } from '@src/lang/wasm'
import { resolveFaceOwner } from '@src/lang/std/artifactGraph'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

type BodyBinding = NonNullable<ArtifactGraph['bodyBindings']>[number]

// Runtime bindings establish identity. The AST is consulted only for whether a
// public name is available at the edit location and which alias to render.
function availableBindings(
  graph: ArtifactGraph,
  ast: Node<Program>,
  nodeToEdit?: PathToNode
) {
  const end = nodeToEdit?.[1]?.[0]
  return (graph.bodyBindings ?? [])
    .map((body) => ({
      body,
      index: ast.body.findIndex((item) => {
        if (item.type === 'VariableDeclaration')
          return item.declaration.id.name === body.variable
        if (item.type !== 'ImportStatement') return false
        const selector = item.selector
        if (selector.type === 'List')
          return selector.items.some(
            (item) => (item.alias ?? item.name).name === body.variable
          )
        return selector.alias?.name === body.variable
      }),
    }))
    .filter(
      ({ index }) => index >= 0 && (typeof end !== 'number' || index < end)
    )
    .sort(
      (a, b) =>
        b.body.indices.length - a.body.indices.length || a.index - b.index
    )
}

export function bodyBindingExpression(
  body: BodyBinding,
  wasmInstance: ModuleType
): Expr {
  return body.indices.reduce<Expr>(
    (expr, index) =>
      createMemberExpression(expr, createLiteral(index, wasmInstance), true),
    createLocalName(body.variable)
  )
}

export function resolveBodyReference(
  id: string,
  graph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
): Expr | Error | undefined {
  const available = availableBindings(graph, ast, nodeToEdit)
  const visited = new Set<string>()
  let current = id
  while (!visited.has(current)) {
    visited.add(current)
    const matches = available.filter(
      ({ body }) => body.bodyId === current || body.artifactId === current
    )
    if (new Set(matches.map((m) => m.body.bodyId)).size > 1)
      return new Error('Select a specific body instance')
    // Semantic artifacts identify a feature; all aliases of its physical body
    // remain candidates for the current command input.
    const ownerId = matches[0]?.body.bodyId
    const match = ownerId
      ? available.filter(({ body }) => body.bodyId === ownerId).at(-1)
      : undefined
    if (match) return bodyBindingExpression(match.body, wasmInstance)
    // Edits may intentionally refer to an earlier, now-consumed input. Their
    // original source binding remains the responsibility of the edit path.
    if (nodeToEdit) return undefined
    const replacement = graph.bodyReplacements?.findLast(
      (r) => r.sourceId === current || r.sourceArtifactId === current
    )
    if (!replacement) return undefined
    if (replacement.outputIds.length !== 1)
      return new Error(
        'This body has no single live successor; select a specific output'
      )
    current = replacement.outputIds[0]
  }
  return undefined
}

// A newly materialized tag must be read from a binding that contains this
// face, which may precede the latest alias used as an operation's body input.
export function resolveFaceContainerReference(
  id: string,
  graph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
): Expr | Error | undefined {
  const owner = resolveFaceOwner(id, graph)
  if (owner instanceof Error) return owner
  if (!owner) return undefined
  const match = availableBindings(graph, ast, nodeToEdit)
    .filter(
      ({ body }) => body.bodyId === owner.bodyId && body.faceIds?.includes(id)
    )
    .sort(
      (a, b) =>
        a.body.indices.length - b.body.indices.length || a.index - b.index
    )[0]
  return match ? bodyBindingExpression(match.body, wasmInstance) : undefined
}

export function resolveNamedFaceReference(
  id: string,
  graph: ArtifactGraph,
  ast: Node<Program>,
  wasmInstance: ModuleType,
  nodeToEdit?: PathToNode
) {
  const owner = resolveFaceOwner(id, graph)
  if (owner instanceof Error) return owner
  if (!owner) return undefined
  const matches = availableBindings(graph, ast, nodeToEdit).flatMap(
    ({ body, index }) =>
      body.faces
        .filter((face) => face.id === id && body.bodyId === owner.bodyId)
        .map((face) => ({ body, face, index }))
  )
  // Prefer the earliest direct binding that already carries this tag. Later
  // merged aliases can expose inherited tags only during engine execution.
  const match = matches.sort(
    (a, b) => a.body.indices.length - b.body.indices.length || a.index - b.index
  )[0]
  if (!match) return undefined
  // Earlier aliases can retain a tag omitted by a later operation on the same
  // physical body. Keep that tag path, but use the latest body alias as input.
  const current =
    availableBindings(graph, ast, nodeToEdit)
      .filter(({ body }) => body.bodyId === owner.bodyId)
      .at(-1) ?? match
  const bodyExpr = bodyBindingExpression(current.body, wasmInstance)
  const tagBodyExpr = bodyBindingExpression(match.body, wasmInstance)
  const tags = match.face.sketch
    ? createMemberExpression(
        createMemberExpression(tagBodyExpr, 'sketch'),
        'tags'
      )
    : createMemberExpression(tagBodyExpr, 'faces')
  const path: PathToNode = [
    ['body', ''],
    [current.index, 'index'],
    ['declaration', 'VariableDeclaration'],
    ['init', ''],
  ]
  return {
    ...match,
    bodyExpr,
    faceExpr: createMemberExpression(tags, match.face.tag),
    path,
  }
}
