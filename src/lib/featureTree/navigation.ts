import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { FeatureTreeExecution } from '@src/lib/featureTree/execution'
import {
  getOperationKey,
  getOperationTreeNodeKey,
  isOperationTreeBranch,
  type OperationTreeNode,
} from '@src/lib/featureTree/featureTreeOperationTree'
import { isArray } from '@src/lib/utils'

/** Explicit preorder rows: presentation cannot change their identity, order or ancestry. */
export type OperationRow = {
  id: string
  parentId?: string
  defaultOpen: boolean
} & (
  | { kind: 'group'; count: number; operationType: Operation['type'] }
  | {
      kind: 'operation'
      operation: Operation
      isModuleOwned: boolean
      referenceModuleId?: number
    }
)
export interface PlaneRow {
  id: string
  planeId: string
  key: 'xz' | 'xy' | 'yz'
  label: string
}
export function buildOperationRows(
  tree: readonly OperationTreeNode[],
  liveActiveModuleId: number | null
): readonly OperationRow[] {
  const rows: OperationRow[] = []
  function visit(
    node: OperationTreeNode,
    parentId?: string,
    isModuleOwned = false
  ) {
    const id = getOperationTreeNodeKey(node)
    if (isArray(node)) {
      const items = node.filter((item) => item.type !== 'GroupEnd')
      if (!items.length) return
      const parent = items[0].type === 'GroupBegin' ? items[0] : undefined
      rows.push(
        parent
          ? {
              id,
              parentId,
              defaultOpen: false,
              kind: 'operation',
              operation: parent,
              isModuleOwned,
            }
          : {
              id,
              parentId,
              defaultOpen: false,
              kind: 'group',
              count: items.length,
              operationType: items[0].type,
            }
      )
      for (const operation of parent ? items.slice(1) : items) {
        rows.push({
          id: getOperationKey(operation),
          parentId: id,
          defaultOpen: false,
          kind: 'operation',
          operation,
          isModuleOwned,
        })
      }
    } else if (isOperationTreeBranch(node)) {
      rows.push({
        id,
        parentId,
        defaultOpen:
          liveActiveModuleId == null ||
          liveActiveModuleId === node.parent.moduleId,
        kind: 'operation',
        operation: node.parent,
        isModuleOwned: true,
      })
      for (const child of node.children) visit(child, id, true)
    } else {
      rows.push({
        id,
        parentId,
        defaultOpen: false,
        kind: 'operation',
        operation: node,
        isModuleOwned,
        referenceModuleId:
          node.type === 'ModuleInstance' ? node.moduleId : undefined,
      })
    }
  }
  for (const node of tree) visit(node)
  return rows
}
export function buildPlaneRows(
  source: FeatureTreeExecution | undefined
): readonly PlaneRow[] {
  const planes = source?.defaultPlanes
  if (!planes || source.isSketching) return []
  return [
    { id: 'plane:xz', planeId: planes.xz, key: 'xz', label: 'Front plane' },
    { id: 'plane:xy', planeId: planes.xy, key: 'xy', label: 'Top plane' },
    { id: 'plane:yz', planeId: planes.yz, key: 'yz', label: 'Side plane' },
  ]
}
