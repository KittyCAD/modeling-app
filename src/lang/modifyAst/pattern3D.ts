import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
} from '@src/lang/create'
import {
  createVariableExpressionsArray,
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import {
  getVariableExprsFromSelection,
  valueOrVariable,
} from '@src/lang/queryAst'
import type { ArtifactGraph, PathToNode, Program } from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export function addPatternCircular3D({
  ast,
  artifactGraph,
  solids,
  instances,
  axis,
  center,
  wasmInstance,
  arcDegrees,
  rotateDuplicates,
  useOriginal,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  instances: KclCommandValue
  axis: KclCommandValue | string // Can be named axis (X, Y, Z) or array [x, y, z]
  center: KclCommandValue // Point3d [x, y, z]
  wasmInstance: ModuleType
  arcDegrees?: KclCommandValue
  rotateDuplicates?: boolean
  useOriginal?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // Prepare function arguments from selected solids
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  // Handle axis parameter - can be named axis or Point3d array
  let axisExpr
  if (typeof axis === 'string') {
    // Named axis like 'X', 'Y', 'Z'
    axisExpr = createLocalName(axis)
  } else if ('value' in axis && isArray(axis.value)) {
    // Direct array value [x, y, z]
    const arrayElements = []
    for (const val of axis.value) {
      if (
        typeof val === 'number' ||
        typeof val === 'string' ||
        typeof val === 'boolean'
      ) {
        arrayElements.push(createLiteral(val, wasmInstance))
      } else {
        return new Error('Invalid axis value type')
      }
    }
    axisExpr = createArrayExpression(arrayElements)
  } else if ('variableName' in axis && axis.variableName) {
    // Variable reference
    axisExpr = valueOrVariable(axis)
  } else {
    // Fallback to valueOrVariable
    axisExpr = valueOrVariable(axis)
  }

  // Handle center parameter - should be Point3d [x, y, z]
  let centerExpr
  if ('value' in center && isArray(center.value)) {
    // Direct array value [x, y, z]
    const arrayElements = []
    for (const val of center.value) {
      if (
        typeof val === 'number' ||
        typeof val === 'string' ||
        typeof val === 'boolean'
      ) {
        arrayElements.push(createLiteral(val, wasmInstance))
      } else {
        return new Error('Invalid center value type')
      }
    }
    centerExpr = createArrayExpression(arrayElements)
  } else {
    // Variable reference or other format
    centerExpr = valueOrVariable(center)
  }

  // Optional labeled arguments
  const arcDegreesExpr = arcDegrees
    ? [createLabeledArg('arcDegrees', valueOrVariable(arcDegrees))]
    : []
  const rotateDuplicatesExpr =
    rotateDuplicates !== undefined
      ? [
          createLabeledArg(
            'rotateDuplicates',
            createLiteral(rotateDuplicates, wasmInstance)
          ),
        ]
      : []
  const useOriginalExpr =
    useOriginal !== undefined
      ? [
          createLabeledArg(
            'useOriginal',
            createLiteral(useOriginal, wasmInstance)
          ),
        ]
      : []

  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('patternCircular3d', solidsExpr, [
    createLabeledArg('instances', valueOrVariable(instances)),
    createLabeledArg('axis', axisExpr),
    createLabeledArg('center', centerExpr),
    ...arcDegreesExpr,
    ...rotateDuplicatesExpr,
    ...useOriginalExpr,
  ])

  // Insert variables for labeled arguments only when we actually use the variable
  if ('variableName' in instances && instances.variableName) {
    insertVariableAndOffsetPathToNode(instances, modifiedAst, mNodeToEdit)
  }
  // Only insert axis variable if we used valueOrVariable (not for strings or arrays)
  if (
    typeof axis !== 'string' &&
    !('value' in axis && isArray(axis.value)) &&
    'variableName' in axis &&
    axis.variableName
  ) {
    insertVariableAndOffsetPathToNode(axis, modifiedAst, mNodeToEdit)
  }
  // Only insert center variable if we used valueOrVariable (not for arrays)
  if (
    !('value' in center && isArray(center.value)) &&
    'variableName' in center &&
    center.variableName
  ) {
    insertVariableAndOffsetPathToNode(center, modifiedAst, mNodeToEdit)
  }
  if (arcDegrees && 'variableName' in arcDegrees && arcDegrees.variableName) {
    insertVariableAndOffsetPathToNode(arcDegrees, modifiedAst, mNodeToEdit)
  }

  // Insert the function call into the AST at the appropriate location
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PATTERN,
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

export function addPatternLinear3D({
  ast,
  artifactGraph,
  solids,
  instances,
  distance,
  axis,
  wasmInstance,
  useOriginal,
  nodeToEdit,
}: {
  ast: Node<Program>
  artifactGraph: ArtifactGraph
  solids: Selections
  instances: KclCommandValue
  distance: KclCommandValue // number(Length)
  axis: KclCommandValue | string // Can be named axis (X, Y, Z) or array [x, y, z]
  wasmInstance: ModuleType
  useOriginal?: boolean
  nodeToEdit?: PathToNode
}): Error | { modifiedAst: Node<Program>; pathToNode: PathToNode } {
  // Clone the ast and nodeToEdit so we can freely edit them
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)

  // Prepare function arguments from selected solids
  const lastChildLookup = true
  const vars = getVariableExprsFromSelection(
    solids,
    modifiedAst,
    wasmInstance,
    mNodeToEdit,
    lastChildLookup,
    artifactGraph
  )
  if (err(vars)) {
    return vars
  }

  // Handle axis parameter - can be named axis or Point3d array
  let axisExpr
  if (typeof axis === 'string') {
    // Named axis like 'X', 'Y', 'Z'
    axisExpr = createLocalName(axis)
  } else if ('value' in axis && isArray(axis.value)) {
    // Direct array value [x, y, z]
    const arrayElements = []
    for (const val of axis.value) {
      if (
        typeof val === 'number' ||
        typeof val === 'string' ||
        typeof val === 'boolean'
      ) {
        arrayElements.push(createLiteral(val, wasmInstance))
      } else {
        return new Error('Invalid axis value type')
      }
    }
    axisExpr = createArrayExpression(arrayElements)
  } else if ('variableName' in axis && axis.variableName) {
    // Variable reference
    axisExpr = valueOrVariable(axis)
  } else {
    // Fallback to valueOrVariable
    axisExpr = valueOrVariable(axis)
  }

  // Optional labeled arguments
  const useOriginalExpr =
    useOriginal !== undefined
      ? [
          createLabeledArg(
            'useOriginal',
            createLiteral(useOriginal, wasmInstance)
          ),
        ]
      : []

  const solidsExpr = createVariableExpressionsArray(vars.exprs)
  const call = createCallExpressionStdLibKw('patternLinear3d', solidsExpr, [
    createLabeledArg('instances', valueOrVariable(instances)),
    createLabeledArg('distance', valueOrVariable(distance)),
    createLabeledArg('axis', axisExpr),
    ...useOriginalExpr,
  ])

  // Insert variables for labeled arguments only when we actually use the variable
  if ('variableName' in instances && instances.variableName) {
    insertVariableAndOffsetPathToNode(instances, modifiedAst, mNodeToEdit)
  }
  if ('variableName' in distance && distance.variableName) {
    insertVariableAndOffsetPathToNode(distance, modifiedAst, mNodeToEdit)
  }
  // Only insert axis variable if we used valueOrVariable (not for strings or arrays)
  if (
    typeof axis !== 'string' &&
    !('value' in axis && isArray(axis.value)) &&
    'variableName' in axis &&
    axis.variableName
  ) {
    insertVariableAndOffsetPathToNode(axis, modifiedAst, mNodeToEdit)
  }

  // Insert the function call into the AST at the appropriate location
  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    pathIfNewPipe: vars.pathIfPipe,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.PATTERN,
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
