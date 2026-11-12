import init, {
  tessellate_snapshot,
} from '@rust/display-tessellation/pkg/display_tessellation.js'
import wasmUrl from '@rust/display-tessellation/pkg/display_tessellation_bg.wasm?url'
import type {
  TessellationRequest,
  TessellationResponse,
} from '@src/clientSideScene/localRenderer/nativeBrep/protocol'

const initializeStartedAt = performance.now()
let initializeMs = 0
const initialized = init({ module_or_path: wasmUrl }).then(
  () => {
    initializeMs = performance.now() - initializeStartedAt
    return undefined
  },
  (error: unknown) => ({ error })
)
let latest: TessellationRequest | undefined
let running = false

self.onmessage = (event: MessageEvent<TessellationRequest>) => {
  latest = event.data
  if (!running) void drain()
}

async function drain() {
  running = true
  try {
    const initializationFailure = await initialized
    if (initializationFailure) {
      self.postMessage({
        id: latest?.id,
        error: `Wasm initialization failed: ${String(initializationFailure.error)}`,
      })
      latest = undefined
      return
    }
    while (latest) {
      const request = latest
      latest = undefined
      let mesh: ReturnType<typeof tessellate_snapshot> | undefined
      try {
        if (request.snapshot.length > 32 * 1024 * 1024) {
          self.postMessage({
            id: request.id,
            error: 'Snapshot exceeds preview size limit',
          })
          continue
        }
        const startedAt = performance.now()
        const input: {
          version: number
          coordinateSystem?: string
          bodies?: { brep: unknown }[]
          errors?: string[]
        } = JSON.parse(request.snapshot)
        const jsonParsedAt = performance.now()
        if (input.errors?.length)
          console.warn(
            '[Native B-rep preview] Skipped bodies',
            JSON.stringify(input.errors)
          )
        const snapshots = input.bodies
          ? input.bodies.map((body) =>
              JSON.stringify({ version: input.version, brep: body.brep })
            )
          : [request.snapshot]
        const bodiesPackedAt = performance.now()
        let wasmMs = 0
        let resultCopyMs = 0
        let attempts = 0
        const chunks: { positions: Float32Array; normals: Float32Array }[] = []
        let faceCount = 0
        let length = 0
        let failed = false
        for (const coarse of [false, true]) {
          attempts++
          chunks.length = 0
          faceCount = 0
          length = 0
          let tessellationError: string | undefined
          try {
            for (const snapshot of snapshots) {
              const wasmStartedAt = performance.now()
              try {
                mesh = tessellate_snapshot(
                  snapshot,
                  request.refinement,
                  coarse
                    ? 0
                    : Math.floor(150_000 / Math.max(1, snapshots.length)),
                  coarse ? 2 : 5,
                  coarse ? 16 : 32
                )
              } finally {
                wasmMs += performance.now() - wasmStartedAt
              }
              const copyStartedAt = performance.now()
              const positions = mesh.positions()
              const normals = mesh.normals()
              const faces: unknown[] = JSON.parse(mesh.faces())
              resultCopyMs += performance.now() - copyStartedAt
              faceCount += faces.length
              length += positions.length
              mesh.free()
              mesh = undefined
              if (length > 200_000 * 9) {
                tessellationError = 'Scene preview triangle budget exceeded'
                break
              }
              chunks.push({ positions, normals })
            }
          } catch (error) {
            mesh?.free()
            mesh = undefined
            tessellationError =
              error instanceof Error ? error.message : String(error)
          }
          if (!tessellationError) break
          if (
            coarse ||
            !tessellationError.toLowerCase().includes('triangle budget')
          ) {
            self.postMessage({ id: request.id, error: tessellationError })
            failed = true
            break
          }
          // Retry the full assembly at lower detail instead of retaining an
          // incomplete old snapshot when smoothing exceeds the scene budget.
        }
        if (failed) continue
        const assemblyStartedAt = performance.now()
        const positions = new Float32Array(length)
        const normals = new Float32Array(length)
        let offset = 0
        for (const chunk of chunks) {
          positions.set(chunk.positions, offset)
          normals.set(chunk.normals, offset)
          offset += chunk.positions.length
        }
        if (input.coordinateSystem === 'z-up') {
          for (const array of [positions, normals]) {
            for (let i = 0; i < array.length; i += 3) {
              const y = array[i + 1]
              array[i + 1] = array[i + 2]
              array[i + 2] = -y
            }
          }
        }
        const response: TessellationResponse = {
          id: request.id,
          positions,
          normals,
          faceCount,
          snapshotBytes: new TextEncoder().encode(request.snapshot).byteLength,
          meshBytes: positions.byteLength + normals.byteLength,
          initializeMs,
          tessellateMs: performance.now() - startedAt,
          profile: {
            jsonParseMs: jsonParsedAt - startedAt,
            bodyPackingMs: bodiesPackedAt - jsonParsedAt,
            wasmMs,
            resultCopyMs,
            assemblyMs: performance.now() - assemblyStartedAt,
            attempts,
          },
        }
        self.postMessage(response, {
          transfer: [positions.buffer, normals.buffer],
        })
      } catch (error) {
        const response: TessellationResponse = {
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }
        self.postMessage(response)
      } finally {
        mesh?.free()
      }
    }
  } catch (error) {
    self.postMessage({
      id: latest?.id,
      error: `Wasm initialization failed: ${String(error)}`,
    })
    latest = undefined
  } finally {
    running = false
  }
}
