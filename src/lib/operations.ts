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
 * Apply all filters to a list of operations.
 */
export function filterOperations(operations: Operation[]): Operation[] {
  return operationFilters.reduce((ops, filterFn) => filterFn(ops), operations)
}

/**
 * The filters to apply to a list of operations
 * for use in the feature tree UI
 */
const operationFilters = [
  isNotUserFunctionWithNoOperations,
  isNotInsideUserFunction,
  isNotUserFunctionReturn,
]

/**
 * A filter to exclude everything that occurs inside a UserDefinedFunctionCall
 * and its corresponding UserDefinedFunctionReturn from a list of operations.
 * This works even when there are nested function calls.
 */
function isNotInsideUserFunction(operations: Operation[]): Operation[] {
  const ops: Operation[] = []
  let depth = 0
  for (const op of operations) {
    if (depth === 0) {
      ops.push(op)
    }
    if (op.type === 'UserDefinedFunctionCall') {
      depth++
    }
    if (op.type === 'UserDefinedFunctionReturn') {
      depth--
      console.assert(
        depth >= 0,
        'Unbalanced UserDefinedFunctionCall and UserDefinedFunctionReturn; too many returns'
      )
    }
  }
  // Depth could be non-zero here if there was an error in execution.
  return ops
}

/**
 * A filter to exclude UserDefinedFunctionCall operations
 * that don't have any operations inside them
 * from a list of operations
 */
function isNotUserFunctionWithNoOperations(
  operations: Operation[]
): Operation[] {
  const ops: Operation[] = []
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    if (op.type !== 'UserDefinedFunctionCall') {
      // Not a call.  Preserve it.
      ops.push(op)
      continue
    }
    // If this is a call at the end of the array, skip it.
    const nextIndex = i + 1
    if (nextIndex >= operations.length) continue

    const nextOp = operations[nextIndex]
    if (nextOp.type === 'UserDefinedFunctionReturn') {
      // Next op is a return.  Skip the call and the return.
      i++
      continue
    }
    // Preserve the call.
    ops.push(op)
  }
  return ops
}

/**
 * A third filter to exclude UserDefinedFunctionReturn operations
 * from a list of operations
 */
function isNotUserFunctionReturn(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type !== 'UserDefinedFunctionReturn')
}
