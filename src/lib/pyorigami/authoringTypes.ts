import { isArray, isRecord } from '@src/lib/utils'

export type DiagramProperty =
  | 'title'
  | 'designer'
  | 'diagrammer'
  | 'colorFront'
  | 'colorBack'
export type AuthoringTarget =
  | { kind: 'property'; property: DiagramProperty }
  | { kind: 'caption'; step: number; caption: number }
export type AuthoringOperation =
  | (AuthoringTarget & { value: string })
  | { kind: 'addStep' }

/** Snapshot-owned hit regions in normalized PDF page coordinates, before canvas transforms. */
export interface AuthoringField {
  page: number
  target: AuthoringTarget
  value: string
  editable: boolean
  x: number
  y: number
  width: number
  height: number
}
export interface AuthoringOutput {
  fields: AuthoringField[]
  canAddStep: boolean
  error?: string
}

function isProperty(value: unknown): value is DiagramProperty {
  return (
    value === 'title' ||
    value === 'designer' ||
    value === 'diagrammer' ||
    value === 'colorFront' ||
    value === 'colorBack'
  )
}
export function isAuthoringOperation(
  value: unknown
): value is AuthoringOperation {
  if (!isRecord(value)) return false
  if (value.kind === 'addStep') return true
  return typeof value.value === 'string' && isTarget(value)
}
function isTarget(value: unknown): value is AuthoringTarget {
  return (
    isRecord(value) &&
    ((value.kind === 'property' && isProperty(value.property)) ||
      (value.kind === 'caption' &&
        typeof value.step === 'number' &&
        Number.isInteger(value.step) &&
        value.step >= 0 &&
        typeof value.caption === 'number' &&
        Number.isInteger(value.caption) &&
        value.caption >= 0))
  )
}
export function parseAuthoringOutput(
  value: unknown
): AuthoringOutput | undefined {
  if (
    !isRecord(value) ||
    !isArray(value.fields) ||
    typeof value.canAddStep !== 'boolean' ||
    (value.error !== undefined && typeof value.error !== 'string')
  )
    return undefined
  const fields: AuthoringField[] = []
  for (const field of value.fields) {
    if (
      !isRecord(field) ||
      !isTarget(field.target) ||
      typeof field.value !== 'string' ||
      typeof field.editable !== 'boolean' ||
      typeof field.page !== 'number' ||
      !Number.isInteger(field.page) ||
      field.page < 0 ||
      typeof field.x !== 'number' ||
      !Number.isFinite(field.x) ||
      typeof field.y !== 'number' ||
      !Number.isFinite(field.y) ||
      typeof field.width !== 'number' ||
      !Number.isFinite(field.width) ||
      typeof field.height !== 'number' ||
      !Number.isFinite(field.height)
    )
      return undefined
    fields.push({
      page: field.page,
      target: field.target,
      value: field.value,
      editable: field.editable,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
    })
  }
  return {
    fields,
    canAddStep: value.canAddStep,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  }
}
