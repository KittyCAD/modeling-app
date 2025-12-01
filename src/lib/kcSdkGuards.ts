import type { OkWebSocketResponseData } from '@kittycad/lib'

type SuccessResp = {
  request_id?: string
  success: boolean
  resp: OkWebSocketResponseData
}
type ModelingOk = Extract<OkWebSocketResponseData, { type: 'modeling' }>
type ExportOk = Extract<OkWebSocketResponseData, { type: 'export' }>
type ModelingBatchOk = Extract<
  OkWebSocketResponseData,
  { type: 'modeling_batch' }
>

export function hasResp(msg: unknown): msg is SuccessResp {
  return 'resp' in (msg as any)
}

export function isModelingResponse(
  msg: unknown
): msg is SuccessResp & { resp: ModelingOk } {
  return hasResp(msg) && (msg as any).resp?.type === 'modeling'
}

export function isExportResponse(
  msg: unknown
): msg is SuccessResp & { resp: ExportOk } {
  return hasResp(msg) && (msg as any).resp?.type === 'export'
}

export function isModelingBatchResponse(
  msg: unknown
): msg is SuccessResp & { resp: ModelingBatchOk } {
  return hasResp(msg) && (msg as any).resp?.type === 'modeling_batch'
}
