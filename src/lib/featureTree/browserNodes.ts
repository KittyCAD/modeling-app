import { getFeatureTreeValueDetail } from '@src/lib/featureTree/operationPresentation'
import type { OperationRow } from '@src/lib/featureTree/navigation'
import type { FeatureTreeModel } from '@src/lib/featureTree/model'
import { getOperationKey } from '@src/lib/featureTree/featureTreeOperationTree'
import { toUtf16 } from '@src/lang/errors'

/** Keyboard metadata is derived from domain rows before any view mounts. */
export interface BrowserNode {
  id: string
  parentId?: string
  label: string
  disabled?: boolean
  moduleId?: number
}
export function operationGroupLabel(type: string, count: number) {
  const label =
    type === 'VariableDeclaration'
      ? 'Parameter'
      : type === 'StdLibCall'
        ? 'Operation'
        : type === 'ModuleInstance'
          ? 'Module'
          : 'Function'
  return `${count} ${label}s`
}
export function featureNodes(model: FeatureTreeModel): readonly BrowserNode[] {
  return [
    ...model.planes.map(({ id, label }) => ({
      id,
      label,
      disabled: model.disabledForUnrenderedChanges,
    })),
    ...model.operationRows.map((row) => ({
      id: row.id,
      moduleId:
        row.kind === 'operation' &&
        row.operation.type === 'ModuleInstance' &&
        row.referenceModuleId == null
          ? row.operation.moduleId
          : undefined,
      parentId: row.parentId,
      label:
        row.kind === 'group'
          ? operationGroupLabel(row.operationType, row.count)
          : operationRowLabel(model, row),
      disabled:
        row.kind === 'operation' &&
        row.referenceModuleId == null &&
        (model.readOnly ||
          (model.sketchNoFace &&
            !(
              row.operation.type === 'StdLibCall' &&
              row.operation.name === 'offsetPlane'
            ))),
    })),
  ]
}
export function bodyNodes(model: FeatureTreeModel): readonly BrowserNode[] {
  return model.bodies.map(({ id, label }) => ({ id: `body:${id}`, label }))
}
export function selectedNodes(model: FeatureTreeModel): readonly string[] {
  const selected: string[] = []
  const ranges = model.selections.graphSelections.flatMap(({ codeRef }) =>
    codeRef ? [codeRef.range] : []
  )
  for (const row of model.operationRows) {
    if (row.kind !== 'operation' || !('sourceRange' in row.operation)) continue
    const [start, end, moduleId] = row.operation.sourceRange
    if (
      model.liveLatestOperationKey === getOperationKey(row.operation) ||
      ranges.some(
        ([from, to, module]) =>
          module === moduleId &&
          from <= toUtf16(end, model.currentCode) &&
          to >= toUtf16(start, model.currentCode)
      )
    )
      selected.push(row.id)
  }
  for (const plane of model.planes)
    if (
      model.selections.otherSelections.some(
        (selection) =>
          typeof selection === 'object' &&
          'id' in selection &&
          selection.id === plane.planeId
      )
    )
      selected.push(plane.id)
  for (const body of model.bodies) {
    const [start, end, moduleId] = body.artifact.codeRef.range
    if (
      body.engineEntityId
        ? model.selections.graphSelections.some(
            (selection) => selection.engineEntityId === body.engineEntityId
          )
        : ranges.some(
            ([from, to, module]) =>
              module === moduleId &&
              from >= toUtf16(start, model.currentCode) &&
              to <= toUtf16(end, model.currentCode)
          )
    )
      selected.push(`body:${body.id}`)
  }
  return selected
}

function operationRowLabel(
  model: FeatureTreeModel,
  row: Extract<OperationRow, { kind: 'operation' }>
): string {
  const description = model.operationDescriptions.get(
    getOperationKey(row.operation)
  )
  const name =
    description?.name ??
    ('name' in row.operation ? row.operation.name : 'Sketch')
  const variableName = row.isModuleOwned ? undefined : description?.variableName
  return variableName && getFeatureTreeValueDetail(row.operation, model.code)
    ? name
    : (variableName ?? name)
}
