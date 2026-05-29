import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  createPathToNodeForLastVariable,
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { getPlaneExprFromSelection } from '@src/lang/modifyAst/faces'
import { getAxisExpression } from '@src/lang/modifyAst/geometry'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type {
  ArtifactGraph,
  Expr,
  PathToNode,
  Program,
  VariableMap,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'

export function addTranslate({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
  x,
  y,
  z,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
  x?: KclCommandValue
  y?: KclCommandValue
  z?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  const xExpr = x ? [createLabeledArg('x', valueOrVariable(x))] : []
  const yExpr = y ? [createLabeledArg('y', valueOrVariable(y))] : []
  const zExpr = z ? [createLabeledArg('z', valueOrVariable(z))] : []
  const globalExpr =
    global !== undefined
      ? [createLabeledArg('global', createLiteral(global, wasmInstance))]
      : []

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('translate', objectsExpr, [
    ...xExpr,
    ...yExpr,
    ...zExpr,
    ...globalExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (x && 'variableName' in x && x.variableName) {
    insertVariableAndOffsetPathToNode(x, modifiedAst, mNodeToEdit)
  }
  if (y && 'variableName' in y && y.variableName) {
    insertVariableAndOffsetPathToNode(y, modifiedAst, mNodeToEdit)
  }
  if (z && 'variableName' in z && z.variableName) {
    insertVariableAndOffsetPathToNode(z, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: undefined, // No variable declaration for translate
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addRotate({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
  roll,
  pitch,
  yaw,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
  roll?: KclCommandValue
  pitch?: KclCommandValue
  yaw?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  const rollExpr = roll ? [createLabeledArg('roll', valueOrVariable(roll))] : []
  const pitchExpr = pitch
    ? [createLabeledArg('pitch', valueOrVariable(pitch))]
    : []
  const yawExpr = yaw ? [createLabeledArg('yaw', valueOrVariable(yaw))] : []
  const globalExpr =
    global !== undefined
      ? [createLabeledArg('global', createLiteral(global, wasmInstance))]
      : []

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('rotate', objectsExpr, [
    ...rollExpr,
    ...pitchExpr,
    ...yawExpr,
    ...globalExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (roll && 'variableName' in roll && roll.variableName) {
    insertVariableAndOffsetPathToNode(roll, modifiedAst, mNodeToEdit)
  }
  if (pitch && 'variableName' in pitch && pitch.variableName) {
    insertVariableAndOffsetPathToNode(pitch, modifiedAst, mNodeToEdit)
  }
  if (yaw && 'variableName' in yaw && yaw.variableName) {
    insertVariableAndOffsetPathToNode(yaw, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: undefined, // No variable declaration for transforms
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addScale({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
  x,
  y,
  z,
  factor,
  global,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
  x?: KclCommandValue
  y?: KclCommandValue
  z?: KclCommandValue
  factor?: KclCommandValue
  global?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  const xExpr = x ? [createLabeledArg('x', valueOrVariable(x))] : []
  const yExpr = y ? [createLabeledArg('y', valueOrVariable(y))] : []
  const zExpr = z ? [createLabeledArg('z', valueOrVariable(z))] : []
  const factorExpr = factor
    ? [createLabeledArg('factor', valueOrVariable(factor))]
    : []
  const globalExpr =
    global !== undefined
      ? [createLabeledArg('global', createLiteral(global, wasmInstance))]
      : []

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('scale', objectsExpr, [
    ...xExpr,
    ...yExpr,
    ...zExpr,
    ...factorExpr,
    ...globalExpr,
  ])

  // Insert variables for labeled arguments if provided
  if (x && 'variableName' in x && x.variableName) {
    insertVariableAndOffsetPathToNode(x, modifiedAst, mNodeToEdit)
  }
  if (y && 'variableName' in y && y.variableName) {
    insertVariableAndOffsetPathToNode(y, modifiedAst, mNodeToEdit)
  }
  if (z && 'variableName' in z && z.variableName) {
    insertVariableAndOffsetPathToNode(z, modifiedAst, mNodeToEdit)
  }
  if (factor && 'variableName' in factor && factor.variableName) {
    insertVariableAndOffsetPathToNode(factor, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: undefined, // No variable declaration for translate
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addClone({
  ast,
  artifactGraph,
  objects,
  variableName,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  variableName: string
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('clone', objectsExpr, [])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const declaration = createVariableDeclaration(variableName, call)
  modifiedAst.body.push(declaration)
  const toFirstKwarg = false
  const pathToNode = createPathToNodeForLastVariable(modifiedAst, toFirstKwarg)
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addAppearance({
  ast,
  artifactGraph,
  objects,
  color,
  wasmInstance,
  metalness,
  roughness,
  opacity,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  color: string
  wasmInstance: ModuleType
  metalness?: KclCommandValue
  roughness?: KclCommandValue
  opacity?: KclCommandValue
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  // Map the sketches selection into a list of kcl expressions to be passed as unlabelled argument
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
    }
  )
  if (err(vars)) {
    return vars
  }

  const colorExpr = [
    createLabeledArg('color', createLiteral(color, wasmInstance)),
  ]
  const metalnessExpr = metalness
    ? [createLabeledArg('metalness', valueOrVariable(metalness))]
    : []
  const roughnessExpr = roughness
    ? [createLabeledArg('roughness', valueOrVariable(roughness))]
    : []
  const opacityExpr = opacity
    ? [createLabeledArg('opacity', valueOrVariable(opacity))]
    : []
  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('appearance', objectsExpr, [
    ...colorExpr,
    ...metalnessExpr,
    ...roughnessExpr,
    ...opacityExpr,
  ])

  if (metalness && 'variableName' in metalness && metalness.variableName) {
    insertVariableAndOffsetPathToNode(metalness, modifiedAst, mNodeToEdit)
  }

  if (roughness && 'variableName' in roughness && roughness.variableName) {
    insertVariableAndOffsetPathToNode(roughness, modifiedAst, mNodeToEdit)
  }

  if (opacity && 'variableName' in opacity && opacity.variableName) {
    insertVariableAndOffsetPathToNode(opacity, modifiedAst, mNodeToEdit)
  }

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: undefined, // No variable declaration for transforms
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

type ObjectTransformName = 'hide' | 'delete'

function addObjectTransform({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
  name,
  variableIfNewDecl,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
  name: ObjectTransformName
  variableIfNewDecl?: string
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)

  // 2. Prepare unlabeled arguments
  // Map the selection into a list of kcl expressions to be passed as unlabelled argument
  const artifact = objects.graphSelections[0].artifact
  const lastChildLookup =
    artifact?.type !== 'helix' && artifact?.type !== 'sketchBlock'
  const vars = getVariableExprsFromSelection(
    objects,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    undefined,
    {
      lastChildLookup,
    }
  )

  if (err(vars)) {
    return vars
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw(name, objectsExpr, [])

  // 3. Just push the new function call to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    variableIfNewDecl,
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}

export function addHide({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addObjectTransform({
    ast,
    artifactGraph,
    objects,
    wasmInstance,
    name: 'hide',
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.HIDDEN,
  })
}

export function addDelete({
  ast,
  artifactGraph,
  objects,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  objects: Selections
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  return addObjectTransform({
    ast,
    artifactGraph,
    objects,
    wasmInstance,
    name: 'delete',
  })
}

export function addMirror3D({
  ast,
  artifactGraph,
  variables,
  bodies,
  across,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  variables: VariableMap
  bodies: Selections
  across: Selections
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // 1. Clone the ast and nodeToEdit so we can freely edit them
  let modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // 2. Prepare unlabeled and labeled arguments
  const vars = getVariableExprsFromSelection(
    bodies,
    artifactGraph,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    {
      lastChildLookup: true,
      artifactTypeFilter: ['compositeSolid', 'sweep'],
    }
  )
  if (err(vars)) {
    return vars
  }

  const isEdgeSelection = across.graphSelections.some(
    (selection) =>
      selection.artifact?.type === 'segment' ||
      selection.artifact?.type === 'sweepEdge' ||
      selection.artifact?.type === 'edgeCutEdge'
  )
  let acrossArg: Expr
  if (isEdgeSelection) {
    const result = getAxisExpression(
      undefined,
      across,
      modifiedAst,
      wasmInstance,
      artifactGraph,
      mNodeToEdit
    )
    if (err(result)) {
      return result
    }
    modifiedAst = result.modifiedAst
    acrossArg = result.generatedAxis
  } else {
    const result = getPlaneExprFromSelection({
      ast: modifiedAst,
      artifactGraph,
      variables,
      plane: across,
      wasmInstance,
      nodeToEdit: mNodeToEdit,
    })
    if (err(result)) {
      return result
    }
    modifiedAst = result.modifiedAst
    acrossArg = result.expr
  }

  const objectsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('mirror3d', objectsExpr, [
    createLabeledArg('across', acrossArg),
  ])

  // 3. If edit, we assign the new function call declaration to the existing node,
  // otherwise just push to the end
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.SOLID,
    wasmInstance,
  })
  if (err(pathToNode)) {
    return pathToNode
  }

  return {
    modifiedAst,
    pathToNode,
  }
}
