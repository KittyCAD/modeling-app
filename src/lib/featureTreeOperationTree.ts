import type { Operation, OpKclValue } from '@rust/kcl-lib/bindings/Operation'

import { getOperationsForModule, type OperationsByModule } from '@src/lang/wasm'
import {
  filterOperations,
  groupNestedOperations,
  groupOperationTypeStreaks,
  type NestedOpList,
} from '@src/lib/operationGrouping'
import { getModuleId, isArray } from '@src/lib/utils'

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>
type StdLibCallOperation = Extract<Operation, { type: 'StdLibCall' }>

export type OperationTreeBranch = {
  parent: ModuleInstanceOperation | StdLibCallOperation
  children: OperationTreeNode[]
}

export type OperationTreeNode = Operation | Operation[] | OperationTreeBranch

export function isOperationTreeBranch(
  node: OperationTreeNode
): node is OperationTreeBranch {
  return !isArray(node) && 'parent' in node && 'children' in node
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
    return node.parent.type === 'ModuleInstance'
      ? `module-${getModuleInstanceKey(node.parent)}`
      : `operation-${getOperationKey(node.parent)}`
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

const REGION_CONSUMING_SWEEPS = new Set(['extrude', 'revolve', 'sweep'])

function collectSketchArtifactIds(value: OpKclValue, artifactIds: Set<string>) {
  if (value.type === 'Sketch') {
    artifactIds.add(value.value.artifactId)
    return
  }

  if (value.type === 'Array') {
    for (const item of value.value) {
      collectSketchArtifactIds(item, artifactIds)
    }
    return
  }

  if (value.type === 'Object') {
    for (const item of Object.values(value.value)) {
      collectSketchArtifactIds(item, artifactIds)
    }
  }
}

function groupConsumedRegions(opList: NestedOpList): OperationTreeNode[] {
  const regionsByArtifactId = new Map<string, StdLibCallOperation>()
  for (const item of opList) {
    if (
      !isArray(item) &&
      item.type === 'StdLibCall' &&
      item.name === 'region' &&
      item.resultArtifactId
    ) {
      regionsByArtifactId.set(item.resultArtifactId, item)
    }
  }

  const regionsByConsumer = new Map<
    StdLibCallOperation,
    StdLibCallOperation[]
  >()
  const consumedRegions = new Set<StdLibCallOperation>()

  for (const item of opList) {
    if (
      isArray(item) ||
      item.type !== 'StdLibCall' ||
      item.isError ||
      !REGION_CONSUMING_SWEEPS.has(item.name) ||
      !item.unlabeledArg
    ) {
      continue
    }

    const artifactIds = new Set<string>()
    collectSketchArtifactIds(item.unlabeledArg.value, artifactIds)
    const regions = [...artifactIds]
      .map((artifactId) => regionsByArtifactId.get(artifactId))
      .filter(
        (region): region is StdLibCallOperation =>
          region !== undefined && !consumedRegions.has(region)
      )

    if (regions.length > 0) {
      regionsByConsumer.set(item, regions)
      for (const region of regions) {
        consumedRegions.add(region)
      }
    }
  }

  const result: OperationTreeNode[] = []
  for (const item of opList) {
    if (
      !isArray(item) &&
      item.type === 'StdLibCall' &&
      consumedRegions.has(item)
    ) {
      continue
    }

    if (!isArray(item) && item.type === 'StdLibCall') {
      const regions = regionsByConsumer.get(item)
      if (regions) {
        result.push({ parent: item, children: regions })
        continue
      }
    }

    result.push(item)
  }

  return result
}

function buildModuleOperationList(operations: Operation[]) {
  const groupedOperations = groupNestedOperations(
    groupOperationTypeStreaks(filterOperations(operations), [
      'VariableDeclaration',
    ]),
    operations,
    (groupBegin) => groupBegin.group.type === 'SketchBlock'
  )

  return groupConsumedRegions(groupedOperations)
}

export function buildOperationTree(
  operationsByModule: OperationsByModule,
  moduleId: number
): OperationTreeNode[] {
  const expandedModules = new Set<number>()
  const nodes = buildModuleOperationTree(
    operationsByModule,
    moduleId,
    new Set(),
    expandedModules
  )
  const displayedModuleInstances = new Set<string>()
  collectModuleInstanceKeys(nodes, displayedModuleInstances)

  for (const operations of Object.values(operationsByModule.map)) {
    for (const operation of operations ?? []) {
      if (operation.type !== 'ModuleInstance') {
        continue
      }

      const key = getModuleInstanceKey(operation)
      if (displayedModuleInstances.has(key)) {
        continue
      }

      // Skip if this module was already expanded elsewhere in the tree.
      if (expandedModules.has(operation.moduleId)) {
        continue
      }

      const node = {
        parent: operation,
        children: buildModuleOperationTree(
          operationsByModule,
          operation.moduleId,
          new Set([operation.sourceRange[2]]),
          expandedModules
        ),
      }
      nodes.push(node)
      collectModuleInstanceKeys([node], displayedModuleInstances)
    }
  }

  return nodes
}

function getModuleInstanceKey(operation: ModuleInstanceOperation): string {
  return `${operation.moduleId}-${operation.sourceRange.join('-')}`
}

function collectModuleInstanceKeys(
  nodes: OperationTreeNode[],
  keys: Set<string>
) {
  for (const node of nodes) {
    if (isArray(node)) {
      for (const operation of node) {
        if (operation.type === 'ModuleInstance') {
          keys.add(getModuleInstanceKey(operation))
        }
      }
      continue
    }

    if (isOperationTreeBranch(node)) {
      if (node.parent.type === 'ModuleInstance') {
        keys.add(getModuleInstanceKey(node.parent))
      }
      collectModuleInstanceKeys(node.children, keys)
      continue
    }

    if (node.type === 'ModuleInstance') {
      keys.add(getModuleInstanceKey(node))
    }
  }
}

function buildModuleOperationTree(
  operationsByModule: OperationsByModule,
  moduleId: number,
  path: Set<number>,
  expandedModules: Set<number>
): OperationTreeNode[] {
  if (path.has(moduleId)) {
    return []
  }

  const nextPath = new Set(path)
  nextPath.add(moduleId)

  return buildModuleOperationList(
    getOperationsForModule(operationsByModule, moduleId)
  ).map((item) => {
    if (
      isArray(item) ||
      isOperationTreeBranch(item) ||
      item.type !== 'ModuleInstance'
    ) {
      return item
    }

    // Only expand a module's children the first time it appears in the tree.
    // Subsequent references to the same module render as a leaf row.
    if (expandedModules.has(item.moduleId)) {
      return item
    }
    expandedModules.add(item.moduleId)

    return {
      parent: item,
      children: buildModuleOperationTree(
        operationsByModule,
        item.moduleId,
        nextPath,
        expandedModules
      ),
    }
  })
}
