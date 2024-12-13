import { CustomIconName } from 'components/CustomIcon'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'

const stdLibIconMap: Record<string, CustomIconName> = {
  chamfer: 'chamfer3d',
  extrude: 'extrude',
  fillet: 'fillet3d',
  import: 'import',
  loft: 'loft',
  offsetPlane: 'plane',
  revolve: 'revolve',
  shell: 'shell',
  startSketchOn: 'sketch',
  sweep: 'sweep',
}

export function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibIconMap[op.name] ?? 'questionMark'
    default:
      return 'make-variable'
  }
}

/**
 * A filter to exclude StdLibCall operations that occur
 * between a UserDefinedFunctionCall and the next UserDefinedFunctionReturn
 * from a list of operations
 */
export function isNotStdLibInUserFunction(
  operation: Operation,
  index: number,
  allOperations: Operation[]
) {
  if (operation.type === 'StdLibCall') {
    const lastUserDefinedFunctionCallIndex = allOperations
      .slice(0, index)
      .findLastIndex((op) => op.type === 'UserDefinedFunctionCall')
    const lastUserDefinedFunctionReturnIndex = allOperations
      .slice(0, index)
      .findLastIndex((op) => op.type === 'UserDefinedFunctionReturn')

    return (
      lastUserDefinedFunctionCallIndex < lastUserDefinedFunctionReturnIndex ||
      lastUserDefinedFunctionReturnIndex === -1
    )
  }
  return true
}

/**
 * A filter to exclude UserDefinedFunctionCall operations
 * that don't have any operations inside them
 * from a list of operations
 */
export function isNotUserFunctionWithNoOperations(
  operation: Operation,
  index: number,
  allOperations: Operation[]
) {
  if (operation.type === 'UserDefinedFunctionCall') {
    return (
      index <= allOperations.length &&
      allOperations[index + 1].type !== 'UserDefinedFunctionReturn'
    )
  }
  return true
}

/**
 * A third filter to exclude UserDefinedFunctionReturn operations
 * from a list of operations
 */
export function isNotUserFunctionReturn(operation: Operation) {
  return operation.type !== 'UserDefinedFunctionReturn'
}
