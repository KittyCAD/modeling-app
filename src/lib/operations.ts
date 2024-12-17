import { CustomIconName } from 'components/CustomIcon'
import { Operation } from 'wasm-lib/kcl/bindings/Operation'

interface StdLibCallInfo {
  label: string
  icon: CustomIconName
}

const stdLibMap: Record<string, StdLibCallInfo> = {
  chamfer: {
    label: 'Chamfer',
    icon: 'chamfer3d',
  },
  extrude: {
    label: 'Extrude',
    icon: 'extrude',
  },
  fillet: {
    label: 'Fillet',
    icon: 'fillet3d',
  },
  hole: {
    label: 'Hole',
    icon: 'hole',
  },
  hollow: {
    label: 'Hollow',
    icon: 'hollow',
  },
  import: {
    label: 'Import',
    icon: 'import',
  },
  loft: {
    label: 'Loft',
    icon: 'loft',
  },
  offsetPlane: {
    label: 'Offset Plane',
    icon: 'plane',
  },
  patternCircular2d: {
    label: 'Circular Pattern',
    icon: 'patternCircular2d',
  },
  patternCircular3d: {
    label: 'Circular Pattern',
    icon: 'patternCircular3d',
  },
  patternLinear2d: {
    label: 'Linear Pattern',
    icon: 'patternLinear2d',
  },
  patternLinear3d: {
    label: 'Linear Pattern',
    icon: 'patternLinear3d',
  },
  revolve: {
    label: 'Revolve',
    icon: 'revolve',
  },
  shell: {
    label: 'Shell',
    icon: 'shell',
  },
  startSketchOn: {
    label: 'Sketch',
    icon: 'sketch',
  },
  sweep: {
    label: 'Sweep',
    icon: 'sweep',
  },
}

/**
 * Returns the label of the operation
 */
export function getOperationLabel(op: Operation): string {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.label ?? op.name
    case 'UserDefinedFunctionCall':
      return op.name ?? 'Anonymous custom function'
    case 'UserDefinedFunctionReturn':
      return 'User function return'
  }
}

/**
 * Returns the icon of the operation
 */
export function getOperationIcon(op: Operation): CustomIconName {
  switch (op.type) {
    case 'StdLibCall':
      return stdLibMap[op.name]?.icon ?? 'questionMark'
    default:
      return 'make-variable'
  }
}

/**
 * The filters to apply to a list of operations
 * for use in the feature tree UI
 */
export const operationFilters = [
  isNotUserFunctionWithNoOperations,
  isNotStdLibInUserFunction,
  isNotUserFunctionReturn,
]

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
