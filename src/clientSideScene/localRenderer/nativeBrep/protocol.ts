export interface TessellationRequest {
  id: number
  snapshot: string
  refinement: number
}

export type TessellationResponse =
  | {
      id: number
      positions: Float32Array
      normals: Float32Array
      faceCount: number
      snapshotBytes: number
      meshBytes: number
      initializeMs: number
      tessellateMs: number
      profile?: {
        jsonParseMs: number
        bodyPackingMs: number
        wasmMs: number
        resultCopyMs: number
        assemblyMs: number
        attempts: number
      }
    }
  | { id: number; error: string }
