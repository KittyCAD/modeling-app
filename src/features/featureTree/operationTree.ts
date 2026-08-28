import type { IconName } from '@kittycad/ui-kit'
import { iconNames } from '@kittycad/ui-kit'
import type { ModuleId } from '@rust/kcl-lib/bindings/ModuleId'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { OperationsByModule } from '@rust/kcl-lib/bindings/OperationsByModule'
import type { SourceRange } from '@rust/kcl-lib/bindings/SourceRange'

/** A displayable operation and the operations structurally below it. */
export interface OperationTreeNode {
  key: string
  moduleId: ModuleId
  operation: Exclude<Operation, { type: 'GroupEnd' }>
  children: OperationTreeNode[]
}

const availableIcons = new Set<string>(iconNames)

const sourceRangeOf = (operation: Operation): SourceRange | null =>
  operation.type === 'GroupEnd' ? null : operation.sourceRange

const operationKey = (
  operation: Operation,
  moduleId: ModuleId,
  index: number
) => {
  const range = sourceRangeOf(operation)
  const name =
    operation.type === 'GroupBegin'
      ? operation.group.type === 'FunctionCall'
        ? operation.group.name
        : operation.group.type
      : 'name' in operation
        ? operation.name
        : null

  return [moduleId, operation.type, name, range?.join('-'), index].join(':')
}

function closingGroupIndex(operations: Operation[], start: number): number {
  let depth = 0
  for (let index = start; index < operations.length; index += 1) {
    const operation = operations[index]
    if (operation.type === 'GroupBegin') {
      depth += 1
    }
    if (operation.type === 'GroupEnd') {
      depth -= 1
    }
    if (depth === 0) {
      return index
    }
  }
  return operations.length
}

function nodesFrom(
  all: OperationsByModule,
  operations: Operation[],
  moduleId: ModuleId,
  modulePath: ReadonlySet<ModuleId>,
  expandedModules: Set<ModuleId>
): OperationTreeNode[] {
  const nodes: OperationTreeNode[] = []

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]
    if (operation.type === 'GroupEnd') {
      continue
    }
    if (
      operation.type === 'StdLibCall' &&
      (operation.name === 'hide' || operation.name === 'exit')
    ) {
      continue
    }

    if (operation.type === 'GroupBegin') {
      const end = closingGroupIndex(operations, index)
      const children = nodesFrom(
        all,
        operations.slice(index + 1, end),
        moduleId,
        modulePath,
        expandedModules
      )

      // A function that produced no modelling operations adds no information.
      if (operation.group.type !== 'FunctionCall' || children.length > 0) {
        nodes.push({
          key: operationKey(operation, moduleId, index),
          moduleId,
          operation,
          children,
        })
      }
      index = end
      continue
    }

    let children: OperationTreeNode[] = []
    if (
      operation.type === 'ModuleInstance' &&
      !modulePath.has(operation.moduleId) &&
      !expandedModules.has(operation.moduleId)
    ) {
      expandedModules.add(operation.moduleId)
      const nextPath = new Set(modulePath)
      nextPath.add(operation.moduleId)
      children = nodesFrom(
        all,
        all.map[operation.moduleId] ?? [],
        operation.moduleId,
        nextPath,
        expandedModules
      )
    }

    nodes.push({
      key: operationKey(operation, moduleId, index),
      moduleId,
      operation,
      children,
    })
  }

  return nodes
}

/** Build the feature tree rooted at the executing file's operation timeline. */
export function buildOperationTree(
  operations: OperationsByModule,
  rootModuleId: ModuleId = 0
): OperationTreeNode[] {
  return nodesFrom(
    operations,
    operations.map[rootModuleId] ?? [],
    rootModuleId,
    new Set([rootModuleId]),
    new Set()
  )
}

const sentenceCase = (value: string) => {
  const words = value
    .split('::')
    .at(-1)
    ?.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .trim()
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : value
}

export function operationLabel(operation: Operation): string {
  switch (operation.type) {
    case 'StdLibCall':
      return sentenceCase(operation.name)
    case 'VariableDeclaration':
      return operation.name
    case 'GroupBegin':
      return operation.group.type === 'SketchBlock'
        ? 'Sketch'
        : sentenceCase(operation.group.name ?? 'Anonymous function')
    case 'ModuleInstance':
      return operation.name
    case 'GroupEnd':
      return 'Group end'
  }
}

export function operationKind(operation: Operation): string {
  switch (operation.type) {
    case 'StdLibCall':
      return 'Operation'
    case 'VariableDeclaration':
      return 'Parameter'
    case 'GroupBegin':
      return operation.group.type === 'SketchBlock' ? 'Sketch' : 'Function'
    case 'ModuleInstance':
      return 'Module'
    case 'GroupEnd':
      return 'Group'
  }
}

export function operationIcon(operation: Operation): IconName {
  switch (operation.type) {
    case 'StdLibCall': {
      const candidate = operation.name.split('::').at(-1) ?? operation.name
      return availableIcons.has(candidate) ? (candidate as IconName) : 'command'
    }
    case 'VariableDeclaration':
      return 'code'
    case 'GroupBegin':
      return operation.group.type === 'SketchBlock' ? 'sketch' : 'function'
    case 'ModuleInstance':
      return 'import'
    case 'GroupEnd':
      return 'command'
  }
}
