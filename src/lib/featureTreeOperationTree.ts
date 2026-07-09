import type { Operation } from '@rust/kcl-lib/bindings/Operation'

import { type OperationsByModule, getOperationsForModule } from '@src/lang/wasm'
import {
  filterOperations,
  groupNestedOperations,
  groupOperationTypeStreaks,
} from '@src/lib/operationGrouping'
import { isArray } from '@src/lib/utils'

type ModuleInstanceOperation = Extract<Operation, { type: 'ModuleInstance' }>

export type OperationTreeBranch = {
  parent: ModuleInstanceOperation
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
    return `module-${getModuleInstanceKey(node.parent)}`
  }

  return getOperationKey(node)
}

export function getOperationKey(operation: Operation): string {
  return `${operation.type}-${
    'name' in operation ? operation.name : 'anonymous'
  }-${'sourceRange' in operation ? operation.sourceRange.join('-') : 'start'}`
}

function buildModuleOperationList(operations: Operation[]) {
  return groupNestedOperations(
    groupOperationTypeStreaks(filterOperations(operations), [
      'VariableDeclaration',
    ]),
    operations,
    (groupBegin) => groupBegin.group.type === 'SketchBlock'
  )
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
      keys.add(getModuleInstanceKey(node.parent))
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
    if (isArray(item) || item.type !== 'ModuleInstance') {
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
