export interface TessellationRequest {
  id: number
  snapshot: string | Uint8Array
  refinement: number
}

export type TessellationResponse =
  | {
      id: number
      positions: Float32Array
      normals: Float32Array
      faceCount: number
    }
  | { id: number; error: string; unsupportedExport?: true }
