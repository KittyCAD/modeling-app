import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { isArray } from '@src/lib/utils'

export type NestedOpList = (Operation | Operation[])[]

type GroupBeginOperation = Extract<Operation, { type: 'GroupBegin' }>

function getGroupBeginSignature(operation: GroupBeginOperation): string {
  return JSON.stringify({
    group: operation.group,
    nodePath: operation.nodePath,
    sourceRange: operation.sourceRange,
  })
}

/**
 * Given an operations list, group streaks of provided types
 * into arrays if they are of a given minimum length
 */
export function groupOperationTypeStreaks(
  opList: Operation[],
  typesToGroup: Operation['type'][],
  minLength = 5
): NestedOpList {
  const result: NestedOpList = []

  let currentType: Operation['type'] | null = null
  let currentStreak: Operation[] = []

  const flushStreak = () => {
    if (currentStreak.length === 0) return
    const shouldGroup =
      currentType !== null &&
      typesToGroup.includes(currentType) &&
      currentStreak.length >= minLength
    if (shouldGroup) {
      result.push([...currentStreak])
    } else {
      for (const op of currentStreak) result.push(op)
    }
    currentStreak = []
    currentType = null
  }

  for (const op of opList) {
    if (currentType === null) {
      currentType = op.type
      currentStreak.push(op)
      continue
    }
    if (op.type === currentType) {
      currentStreak.push(op)
    } else {
      // Type changed; flush the previous streak and start anew
      flushStreak()
      currentType = op.type
      currentStreak.push(op)
    }
  }

  // Flush any remaining streak
  flushStreak()

  return result
}

/**
 * Given a filtered operation list and the original operation stream, replace
 * top-level GroupBegin operations with their full nested operation groups.
 *
 * This is generic over group type and allows callers to opt in to grouping any
 * subset of GroupBegin operations.
 */
export function groupNestedOperations(
  opList: NestedOpList,
  allOperations: Operation[],
  shouldGroup: (groupBegin: GroupBeginOperation) => boolean
): NestedOpList {
  const groupOperationsByKey = new Map<string, Operation[]>()
  const keyByGroupBegin = new Map<GroupBeginOperation, string>()
  const seenSignatureCounts = new Map<string, number>()
  const stack: {
    begin: GroupBeginOperation
    key: string
    items: Operation[]
  }[] = []

  for (const operation of allOperations) {
    if (operation.type === 'GroupBegin') {
      const signature = getGroupBeginSignature(operation)
      const ordinal = seenSignatureCounts.get(signature) ?? 0
      seenSignatureCounts.set(signature, ordinal + 1)
      const key = `${signature}#${ordinal}`
      keyByGroupBegin.set(operation, key)
      stack.push({ begin: operation, key, items: [operation] })
      continue
    }

    if (operation.type === 'GroupEnd') {
      const current = stack.pop()
      if (!current) {
        console.assert(
          false,
          'Unbalanced GroupBegin and GroupEnd; too many ends while grouping'
        )
        continue
      }

      current.items.push(operation)
      groupOperationsByKey.set(current.key, current.items)

      if (stack.length > 0) {
        stack[stack.length - 1].items.push(...current.items)
      }
      continue
    }

    if (stack.length > 0) {
      stack[stack.length - 1].items.push(operation)
    }
  }

  const result: NestedOpList = []
  const requestedSignatureCounts = new Map<string, number>()
  for (const item of opList) {
    if (isArray(item)) {
      result.push(item)
      continue
    }

    if (item.type !== 'GroupBegin' || !shouldGroup(item)) {
      result.push(item)
      continue
    }

    let key = keyByGroupBegin.get(item)
    if (!key) {
      const signature = getGroupBeginSignature(item)
      const ordinal = requestedSignatureCounts.get(signature) ?? 0
      requestedSignatureCounts.set(signature, ordinal + 1)
      key = `${signature}#${ordinal}`
    }
    result.push(
      key !== undefined ? (groupOperationsByKey.get(key) ?? item) : item
    )
  }

  return result
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
  isNotInsideGroup,
  isNotGroupEnd,
  isNotHideOperation,
]

/**
 * A filter to exclude everything that occurs inside a GroupBegin and its
 * corresponding GroupEnd from a list of operations. This works even when there
 * are nested function calls and module instances.
 */
function isNotInsideGroup(operations: Operation[]): Operation[] {
  const ops: Operation[] = []
  let depth = 0
  for (const op of operations) {
    if (depth === 0) {
      ops.push(op)
    }
    if (op.type === 'GroupBegin') {
      depth++
    }
    if (op.type === 'GroupEnd') {
      depth--
      console.assert(
        depth >= 0,
        'Unbalanced GroupBegin and GroupEnd; too many ends'
      )
    }
  }
  // Depth could be non-zero here if there was an error in execution.
  return ops
}

/**
 * A filter to exclude GroupBegin operations and their corresponding GroupEnd
 * that don't have any operations inside them from a list of operations, if it's
 * a function call.
 */
function isNotUserFunctionWithNoOperations(
  operations: Operation[]
): Operation[] {
  return operations.filter((op, index) => {
    if (
      op.type === 'GroupBegin' &&
      op.group.type === 'FunctionCall' &&
      // If this is a "begin" at the end of the array, it's preserved.
      index < operations.length - 1 &&
      operations[index + 1].type === 'GroupEnd'
    )
      return false
    const previousOp = index > 0 ? operations[index - 1] : undefined
    if (
      op.type === 'GroupEnd' &&
      // If this is an "end" at the beginning of the array, it's preserved.
      previousOp !== undefined &&
      previousOp.type === 'GroupBegin' &&
      previousOp.group.type === 'FunctionCall'
    )
      return false

    return true
  })
}

/**
 * A filter to exclude GroupEnd operations from a list of operations.
 */
function isNotGroupEnd(ops: Operation[]): Operation[] {
  return ops.filter((op) => op.type !== 'GroupEnd')
}

/**
 * A filter to exclude `hide()` operations from a list of operations.
 */
function isNotHideOperation(ops: Operation[]): Operation[] {
  return ops.filter((op) => !(op.type === 'StdLibCall' && op.name === 'hide'))
}
