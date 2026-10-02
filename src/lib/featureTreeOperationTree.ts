import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import type { OperationsByModule } from '@src/lang/wasm'
import {
  filterOperations,
  groupNestedOperations,
  groupOperationTypeStreaks,
} from '@src/lib/operationGrouping'
import { getModuleId, isArray } from '@src/lib/utils'

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>
type StdLibCallOperation = Extract<Operation, { type: 'StdLibCall' }>

export type OperationTreeBranch = {
  parent: ModuleInstanceOperation
}

export type OperationTreeNode = Operation | Operation[] | OperationTreeBranch

export type OperationTree = {
  nodes: OperationTreeNode[]
  getChildren: (branch: OperationTreeBranch) => OperationTreeNode[]
  /** Canonical ancestors including the target module, excluding the root. */
  getModuleAncestors: (moduleId: number) => number[]
}

export function isOperationTreeBranch(
  node: OperationTreeNode
): node is OperationTreeBranch {
  return !isArray(node) && 'parent' in node
}

export function getOperationTreeNodeKey(node: OperationTreeNode): string {
  if (isArray(node)) {
    const first = node[0]
    const last = node[node.length - 1]
    return `group-${
      first?.type ?? 'unknown'
    }-${first ? getOperationKey(first) : 'start'}-${
      last ? getOperationKey(last) : 'end'
    }`
  }

  if (isOperationTreeBranch(node)) {
    return `module-${getModuleInstanceKey(node.parent)}`
  }

  return getOperationKey(node)
}

export function getOperationKey(operation: Operation): string {
  return `${operation.type}-${
    'name' in operation ? operation.name : 'anonymous'
  }-${'sourceRange' in operation ? operation.sourceRange.join('-') : 'start'}`
}

/**
 * Finds the same visible stdlib operation after a source rewrite by preserving its
 * index among all visible operations in the same module.
 */
export function findSameVisibleStdLibOperationAfterSourceChange(input: {
  operation: StdLibCallOperation
  beforeOperations: Operation[]
  afterOperations: Operation[]
}): StdLibCallOperation | undefined {
  const beforeOperations = getVisibleSameModuleOperations(
    input.beforeOperations,
    input.operation
  )
  const operationIndex = beforeOperations.findIndex((operation) =>
    isSameSourceOperation(operation, input.operation)
  )
  if (operationIndex === -1) {
    return undefined
  }

  const afterOperations = getVisibleSameModuleOperations(
    input.afterOperations,
    input.operation
  )
  if (beforeOperations.length !== afterOperations.length) {
    return undefined
  }

  const operation = afterOperations[operationIndex]
  if (
    operation?.type !== 'StdLibCall' ||
    operation.name !== input.operation.name
  ) {
    return undefined
  }

  return operation
}

/**
 * Returns operations visible in the feature tree for the same module as the
 * given operation.
 */
function getVisibleSameModuleOperations(
  operations: Operation[],
  operation: StdLibCallOperation
): Operation[] {
  const moduleId = getOperationModuleId(operation)
  return filterOperations(operations).filter(
    (candidate) => getOperationModuleId(candidate) === moduleId
  )
}

/**
 * Returns the module id encoded in an operation's source range.
 */
function getOperationModuleId(operation: Operation): number | undefined {
  return 'sourceRange' in operation
    ? getModuleId(operation.sourceRange)
    : undefined
}

/**
 * Checks whether two operations point at the same source operation before a
 * rewrite changes ranges.
 */
function isSameSourceOperation(left: Operation, right: Operation): boolean {
  if (left === right) {
    return true
  }
  if (
    left.type !== right.type ||
    !('sourceRange' in left) ||
    !('sourceRange' in right)
  ) {
    return false
  }

  return (
    left.sourceRange[0] === right.sourceRange[0] &&
    left.sourceRange[1] === right.sourceRange[1] &&
    left.sourceRange[2] === right.sourceRange[2]
  )
}

// Live updates replace only the changed module's array. Weak keys let unchanged
// modules reuse their grouping without retaining operations from old executions.
const moduleOperationLists = new WeakMap<
  Operation[],
  (Operation | Operation[])[]
>()
const emptyOperations: Operation[] = []

function buildModuleOperationList(operations: Operation[]) {
  const cached = moduleOperationLists.get(operations)
  if (cached) {
    return cached
  }

  const list = groupNestedOperations(
    groupOperationTypeStreaks(filterOperations(operations), [
      'VariableDeclaration',
    ]),
    operations,
    (groupBegin) => groupBegin.group.type === 'SketchBlock'
  )
  moduleOperationLists.set(operations, list)
  return list
}

type ModuleReferences = {
  all: ModuleInstanceOperation[]
  direct: ModuleInstanceOperation[]
  displayedKeys: string[]
}

const moduleReferences = new WeakMap<Operation[], ModuleReferences>()

/** Read only the import topology; grouping may serialize large argument values. */
function getModuleReferences(operations: Operation[]): ModuleReferences {
  const cached = moduleReferences.get(operations)
  if (cached) {
    return cached
  }

  const references: ModuleReferences = {
    all: [],
    direct: [],
    displayedKeys: [],
  }
  let depth = 0
  let sketchReferences: string[] | undefined
  for (const operation of operations) {
    if (operation.type === 'GroupBegin') {
      if (depth === 0 && operation.group.type === 'SketchBlock') {
        sketchReferences = []
      }
      depth++
    } else if (operation.type === 'GroupEnd') {
      depth = Math.max(0, depth - 1)
      if (depth === 0 && sketchReferences) {
        // Completed sketch groups display these imports inside their grouped
        // rows. Incomplete live groups still need the fallback import rows.
        for (const key of sketchReferences) {
          references.displayedKeys.push(key)
        }
        sketchReferences = undefined
      }
    } else if (operation.type === 'ModuleInstance') {
      references.all.push(operation)
      const key = getModuleInstanceKey(operation)
      if (depth === 0) {
        references.direct.push(operation)
        references.displayedKeys.push(key)
      } else {
        sketchReferences?.push(key)
      }
    }
  }
  moduleReferences.set(operations, references)
  return references
}

/**
 * Choose each module's canonical row from the import topology, independently of
 * expansion order. Only the root's operation rows are built until getChildren
 * is called for an expanded module.
 */
export function buildOperationTree(
  operationsByModule: OperationsByModule,
  rootModuleId: number
): OperationTree {
  const operationsFor = (moduleId: number) =>
    operationsByModule.map[moduleId] ?? emptyOperations
  const canonicalImports = new Map<number, ModuleInstanceOperation>()
  const parentModules = new Map<number, number>()
  const visitedModules = new Set([rootModuleId])
  const displayedModuleInstances = new Set<string>()

  const referencesFor = (moduleId: number) => {
    const references = getModuleReferences(operationsFor(moduleId))
    for (const key of references.displayedKeys) {
      displayedModuleInstances.add(key)
    }
    return references.direct
  }

  const visitModule = (moduleId: number) => {
    // Iterative depth-first traversal also handles deeply nested import graphs.
    const stack = [{ moduleId, references: referencesFor(moduleId), index: 0 }]
    while (stack.length > 0) {
      const current = stack[stack.length - 1]
      const operation = current.references[current.index++]
      if (!operation) {
        stack.pop()
        continue
      }
      if (visitedModules.has(operation.moduleId)) {
        continue
      }
      visitedModules.add(operation.moduleId)
      canonicalImports.set(operation.moduleId, operation)
      parentModules.set(operation.moduleId, current.moduleId)
      stack.push({
        moduleId: operation.moduleId,
        references: referencesFor(operation.moduleId),
        index: 0,
      })
    }
  }
  visitModule(rootModuleId)

  const fallbackBranches: OperationTreeBranch[] = []
  for (const operations of Object.values(operationsByModule.map)) {
    for (const operation of getModuleReferences(operations ?? emptyOperations)
      .all) {
      if (
        displayedModuleInstances.has(getModuleInstanceKey(operation)) ||
        visitedModules.has(operation.moduleId)
      ) {
        continue
      }
      // Imports hidden inside function groups still need an accessible row.
      visitedModules.add(operation.moduleId)
      canonicalImports.set(operation.moduleId, operation)
      parentModules.set(operation.moduleId, rootModuleId)
      fallbackBranches.push({ parent: operation })
      visitModule(operation.moduleId)
    }
  }

  const nodesByModule = new Map<number, OperationTreeNode[]>()
  const buildModuleNodes = (moduleId: number): OperationTreeNode[] => {
    const cached = nodesByModule.get(moduleId)
    if (cached) {
      return cached
    }
    const nodes = buildModuleOperationList(operationsFor(moduleId)).map(
      (item) => {
        if (
          isArray(item) ||
          item.type !== 'ModuleInstance' ||
          canonicalImports.get(item.moduleId) !== item
        ) {
          return item
        }
        return { parent: item }
      }
    )
    nodesByModule.set(moduleId, nodes)
    return nodes
  }

  return {
    nodes: [...buildModuleNodes(rootModuleId), ...fallbackBranches],
    getChildren: (branch) => buildModuleNodes(branch.parent.moduleId),
    getModuleAncestors: (moduleId) => {
      const ancestors: number[] = []
      let current = moduleId
      let parent = parentModules.get(current)
      while (current !== rootModuleId && parent !== undefined) {
        ancestors.push(current)
        current = parent
        parent = parentModules.get(current)
      }
      return ancestors.reverse()
    },
  }
}

function getModuleInstanceKey(operation: ModuleInstanceOperation): string {
  return `${operation.moduleId}-${operation.sourceRange.join('-')}`
}
