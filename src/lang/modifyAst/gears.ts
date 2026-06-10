import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createIdentifier,
  createLabeledArg,
} from '@src/lang/create'
import {
  insertVariableAndOffsetPathToNode,
  setCallInAst,
} from '@src/lang/modifyAst'
import { valueOrVariable } from '@src/lang/queryAst'
import type { PathToNode, Program } from '@src/lang/wasm'
import { modelingStdLibCall } from '@src/lib/commandBarConfigs/modelingCommandStdLib'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { KCL_DEFAULT_CONSTANT_PREFIXES } from '@src/lib/constants'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

function insertKclVariableIfNeeded(
  value: KclCommandValue,
  ast: Node<Program>,
  nodeToEdit?: PathToNode
) {
  if ('variableName' in value && value.variableName) {
    insertVariableAndOffsetPathToNode(value, ast, nodeToEdit)
  }
}

export function addHelicalGear({
  ast,
  nTeeth,
  module,
  pressureAngle,
  helixAngle,
  gearHeight,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  nTeeth: KclCommandValue
  module: KclCommandValue
  pressureAngle: KclCommandValue
  helixAngle: KclCommandValue
  gearHeight: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const stdLibCall = modelingStdLibCall('Helical Gear')

  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    [
      createLabeledArg('nTeeth', valueOrVariable(nTeeth)),
      createLabeledArg('module', valueOrVariable(module)),
      createLabeledArg('pressureAngle', valueOrVariable(pressureAngle)),
      createLabeledArg('helixAngle', valueOrVariable(helixAngle)),
      createLabeledArg('gearHeight', valueOrVariable(gearHeight)),
    ],
    undefined,
    stdLibCall.path.map(createIdentifier)
  )

  insertKclVariableIfNeeded(nTeeth, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(module, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(pressureAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(helixAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(gearHeight, modifiedAst, mNodeToEdit)

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.GEAR,
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

export function addHerringboneGear({
  ast,
  nTeeth,
  module,
  pressureAngle,
  gearHeight,
  helixAngle,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  nTeeth: KclCommandValue
  module: KclCommandValue
  pressureAngle: KclCommandValue
  gearHeight: KclCommandValue
  helixAngle: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const stdLibCall = modelingStdLibCall('Herringbone Gear')

  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    [
      createLabeledArg('nTeeth', valueOrVariable(nTeeth)),
      createLabeledArg('module', valueOrVariable(module)),
      createLabeledArg('pressureAngle', valueOrVariable(pressureAngle)),
      createLabeledArg('gearHeight', valueOrVariable(gearHeight)),
      createLabeledArg('helixAngle', valueOrVariable(helixAngle)),
    ],
    undefined,
    stdLibCall.path.map(createIdentifier)
  )

  insertKclVariableIfNeeded(nTeeth, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(module, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(pressureAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(gearHeight, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(helixAngle, modifiedAst, mNodeToEdit)

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.GEAR,
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

export function addSpurGear({
  ast,
  nTeeth,
  module,
  pressureAngle,
  gearHeight,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  nTeeth: KclCommandValue
  module: KclCommandValue
  pressureAngle: KclCommandValue
  gearHeight: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const stdLibCall = modelingStdLibCall('Spur Gear')

  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    [
      createLabeledArg('nTeeth', valueOrVariable(nTeeth)),
      createLabeledArg('module', valueOrVariable(module)),
      createLabeledArg('pressureAngle', valueOrVariable(pressureAngle)),
      createLabeledArg('gearHeight', valueOrVariable(gearHeight)),
    ],
    undefined,
    stdLibCall.path.map(createIdentifier)
  )

  insertKclVariableIfNeeded(nTeeth, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(module, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(pressureAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(gearHeight, modifiedAst, mNodeToEdit)

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.GEAR,
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

export function addRingGear({
  ast,
  nTeeth,
  module,
  pressureAngle,
  helixAngle,
  gearHeight,
  nodeToEdit,
  wasmInstance,
}: {
  ast: Node<Program>
  nTeeth: KclCommandValue
  module: KclCommandValue
  pressureAngle: KclCommandValue
  helixAngle: KclCommandValue
  gearHeight: KclCommandValue
  nodeToEdit?: PathToNode
  wasmInstance: ModuleType
}):
  | {
      modifiedAst: Node<Program>
      pathToNode: PathToNode
    }
  | Error {
  const modifiedAst = structuredClone(ast)
  const mNodeToEdit = structuredClone(nodeToEdit)
  const stdLibCall = modelingStdLibCall('Ring Gear')

  const call = createCallExpressionStdLibKw(
    stdLibCall.name,
    null,
    [
      createLabeledArg('nTeeth', valueOrVariable(nTeeth)),
      createLabeledArg('module', valueOrVariable(module)),
      createLabeledArg('pressureAngle', valueOrVariable(pressureAngle)),
      createLabeledArg('helixAngle', valueOrVariable(helixAngle)),
      createLabeledArg('gearHeight', valueOrVariable(gearHeight)),
    ],
    undefined,
    stdLibCall.path.map(createIdentifier)
  )

  insertKclVariableIfNeeded(nTeeth, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(module, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(pressureAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(helixAngle, modifiedAst, mNodeToEdit)
  insertKclVariableIfNeeded(gearHeight, modifiedAst, mNodeToEdit)

  const pathToNode = setCallInAst({
    ast: modifiedAst,
    call,
    pathToEdit: mNodeToEdit,
    variableIfNewDecl: KCL_DEFAULT_CONSTANT_PREFIXES.GEAR,
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
