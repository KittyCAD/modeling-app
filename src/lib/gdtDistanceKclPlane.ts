import type { Artifact, ArtifactGraph, Expr, Program } from '@src/lang/wasm'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Selections } from '@src/machines/modelingSharedTypes'

type FramePlane = 'XY' | 'XZ' | 'YZ'

/** Resolve standard sketch planes through KCL aliases and extrusion inputs. */
export function getDistanceFramePlaneFromKcl(
  ast: Node<Program> | undefined,
  graph: ArtifactGraph | undefined,
  selections: Selections | undefined
): FramePlane | undefined {
  if (!ast || !graph || !selections) return undefined
  const variables = new Map<string, Expr>()
  for (const statement of ast.body) {
    if (statement.type === 'VariableDeclaration') {
      variables.set(statement.declaration.id.name, statement.declaration.init)
    }
  }
  const resolve = (
    expr: Expr | undefined,
    visited = new Set<string>()
  ): FramePlane | undefined => {
    if (!expr) return undefined
    if (expr.type === 'Name') {
      const name = expr.name.name
      if (
        expr.path.length === 0 &&
        ['XY', 'XZ', 'YZ', '-XY', '-XZ', '-YZ'].includes(name)
      ) {
        return name.replace('-', '') as FramePlane
      }
      if (expr.path.length || visited.has(name)) return undefined
      return resolve(variables.get(name), new Set([...visited, name]))
    }
    if (expr.type === 'Literal' && typeof expr.value === 'string') {
      const name = expr.value.replace('-', '')
      return name === 'XY' || name === 'XZ' || name === 'YZ' ? name : undefined
    }
    if (expr.type === 'UnaryExpression') return resolve(expr.argument, visited)
    if (expr.type === 'MemberExpression') return resolve(expr.object, visited)
    if (expr.type === 'SketchBlock') {
      return resolve(
        expr.arguments.find((arg) => arg.label?.name === 'on')?.arg,
        visited
      )
    }
    if (expr.type !== 'CallExpressionKw' || expr.callee.path.length)
      return undefined
    const name = expr.callee.name.name
    if (name === 'region') {
      const sketch = expr.arguments.find(
        (arg) => arg.label?.name === 'sketch'
      )?.arg
      if (sketch) return resolve(sketch, visited)
      const segments = expr.arguments.find(
        (arg) => arg.label?.name === 'segments'
      )?.arg
      if (segments?.type !== 'ArrayExpression') return undefined
      const planes = segments.elements.map((segment) =>
        resolve(segment, visited)
      )
      return planes[0] && planes.every((plane) => plane === planes[0])
        ? planes[0]
        : undefined
    }
    // Do not guess through rotations, booleans, sweeps or revolutions.
    if (
      !['extrude', 'offsetPlane', 'startSketchOn', 'startProfile'].includes(
        name
      )
    )
      return undefined
    return resolve(expr.unlabeled ?? undefined, visited)
  }

  const sourcePlane = (
    artifact: Artifact,
    visited = new Set<string>()
  ): FramePlane | undefined => {
    if (visited.has(artifact.id)) return undefined
    visited.add(artifact.id)
    if (artifact.type === 'sketchBlock' && artifact.standardPlane) {
      const plane = artifact.standardPlane.replace('-', '').toUpperCase()
      if (plane === 'XY' || plane === 'XZ' || plane === 'YZ') return plane
    }
    if ('codeRef' in artifact && artifact.codeRef) {
      const bodyIndex = artifact.codeRef.pathToNode.find(
        ([_, kind]) => kind === 'index'
      )?.[0]
      if (typeof bodyIndex === 'number') {
        const statement = ast.body[bodyIndex]
        if (statement?.type === 'VariableDeclaration') {
          const plane = resolve(statement.declaration.init)
          if (plane) return plane
          // A body transformed after extrusion must use evaluated geometry.
          if (artifact.type === 'sweep' || artifact.type === 'compositeSolid')
            return undefined
        }
      }
    }
    const parent =
      artifact.type === 'wall' ||
      artifact.type === 'cap' ||
      artifact.type === 'sweepEdge'
        ? artifact.sweepId
        : artifact.type === 'primitiveFace' || artifact.type === 'primitiveEdge'
          ? artifact.solidId
          : artifact.type === 'segment'
            ? artifact.pathId
            : artifact.type === 'path'
              ? (artifact.sketchBlockId ?? artifact.planeId)
              : undefined
    const parentArtifact = parent ? graph.get(parent) : undefined
    return parentArtifact ? sourcePlane(parentArtifact, visited) : undefined
  }

  const artifacts: Artifact[] = []
  for (const selection of selections.graphSelections) {
    if (selection.artifact && selection.entityRef?.type !== 'edge')
      artifacts.push(selection.artifact)
    else {
      const start = artifacts.length
      if (selection.entityRef?.type === 'edge') {
        for (const id of [...selection.entityRef.side_faces]) {
          const artifact = graph.get(id)
          if (artifact) artifacts.push(artifact)
        }
      }
      if (artifacts.length === start && selection.artifact)
        artifacts.push(selection.artifact)
      if (artifacts.length === start && selection.engineTopologyFallback) {
        const body = graph.get(selection.engineTopologyFallback.parentId)
        if (body) artifacts.push(body)
      }
    }
  }
  for (const selection of selections.otherSelections) {
    if (
      typeof selection === 'object' &&
      'type' in selection &&
      selection.type === 'enginePrimitive'
    ) {
      const artifact = selection.parentEntityId
        ? graph.get(selection.parentEntityId)
        : undefined
      if (artifact) artifacts.push(artifact)
    }
  }
  const planes = artifacts.map((artifact) => sourcePlane(artifact))
  const caps = artifacts.filter((artifact) => artifact.type === 'cap')
  const plane = planes[0]
  if (!plane || planes.some((candidate) => candidate !== plane))
    return undefined
  if (
    (caps.length > 0 &&
      selections.graphSelections.length + selections.otherSelections.length ===
        1) ||
    artifacts.every(
      (artifact) =>
        artifact.type === 'segment' ||
        (artifact.type === 'sweepEdge' && artifact.subType === 'opposite')
    )
  )
    return plane
  // Two rims on the same cap, or two cylindrical walls, are separated in
  // the sketch plane. Opposite caps and extrusion edges span its normal.
  if (
    (caps.length >= 2 && caps.every((cap) => cap.id === caps[0].id)) ||
    (selections.graphSelections.length + selections.otherSelections.length >=
      2 &&
      artifacts.every((artifact) => artifact.type === 'wall'))
  ) {
    return plane
  }
  // Opaque primitive IDs identify the body, not an extrusion edge.
  // Prefer the sketch plane for paired features unless opposite caps
  // explicitly establish a measurement along the extrusion.
  if (
    caps.length < 2 &&
    selections.graphSelections.length + selections.otherSelections.length >= 2
  )
    return plane
  return plane === 'XY' ? 'XZ' : 'XY'
}
