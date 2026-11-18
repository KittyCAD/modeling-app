import type { NativeBrepSceneSnapshot, NativeBrepSnapshot } from '@kittycad/lib'
import init, {
  tessellate_snapshot,
} from '@rust/display-tessellation/pkg/display_tessellation.js'
import wasmUrl from '@rust/display-tessellation/pkg/display_tessellation_bg.wasm?url'
import type {
  TessellationRequest,
  TessellationResponse,
} from '@src/clientSideScene/localRenderer/nativeBrep/protocol'

const initialized = init({ module_or_path: wasmUrl }).then(
  () => undefined,
  (error: unknown) => ({ error })
)
let latest: TessellationRequest | undefined
let running = false
type BodyMesh = {
  positions: Float32Array
  normals: Float32Array
  faceCount: number
  coarse: boolean
}
const bodyCache = new Map<string, BodyMesh>()
const cacheLimit = 32 * 1024 * 1024
let cacheBytes = 0

function cacheBody(key: string, mesh: BodyMesh) {
  const bytes =
    key.length * 2 + mesh.positions.byteLength + mesh.normals.byteLength
  if (bytes > cacheLimit) return
  const previous = bodyCache.get(key)
  if (previous)
    cacheBytes -=
      key.length * 2 +
      previous.positions.byteLength +
      previous.normals.byteLength
  bodyCache.delete(key)
  bodyCache.set(key, mesh)
  cacheBytes += bytes
  while (cacheBytes > cacheLimit) {
    const oldest = bodyCache.entries().next().value
    if (!oldest) break
    const [key, mesh] = oldest
    bodyCache.delete(key)
    cacheBytes -=
      key.length * 2 + mesh.positions.byteLength + mesh.normals.byteLength
  }
}

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
    requests: while (latest) {
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
        const input = JSON.parse(
          request.snapshot
        ) as Partial<NativeBrepSceneSnapshot> & Partial<NativeBrepSnapshot>
        const { version } = input
        if (version !== 1) {
          self.postMessage({
            id: request.id,
            error: 'Unsupported native B-rep snapshot version',
          })
          continue
        }
        if (
          (input.bodies !== undefined ||
            input.coordinateSystem !== undefined) &&
          input.coordinateSystem !== 'z-up'
        ) {
          self.postMessage({
            id: request.id,
            error: 'Unsupported native B-rep coordinate system',
          })
          continue
        }
        if (input.errors?.length)
          console.warn(
            '[Native B-rep preview] Skipped bodies',
            JSON.stringify(input.errors)
          )
        const snapshots = input.bodies
          ? input.bodies.map((body) =>
              JSON.stringify({
                version,
                brep: body.brep,
              } satisfies NativeBrepSnapshot)
            )
          : [request.snapshot]
        const keys = snapshots.map(
          (snapshot) => `${request.refinement}:${snapshot}`
        )
        const currentKeys = new Set(keys)
        for (const [key, mesh] of bodyCache) {
          if (currentKeys.has(key)) continue
          bodyCache.delete(key)
          cacheBytes -=
            key.length * 2 + mesh.positions.byteLength + mesh.normals.byteLength
        }
        const chunks: BodyMesh[] = []
        let length = 0
        const tessellateBody = (index: number, coarse: boolean): BodyMesh => {
          try {
            mesh = tessellate_snapshot(
              snapshots[index],
              request.refinement,
              coarse ? 0 : Math.floor(150_000 / Math.max(1, snapshots.length)),
              coarse ? 2 : 5,
              coarse ? 16 : 32,
              coarse
                ? undefined
                : Math.floor(200_000 / Math.max(1, snapshots.length))
            )
            return {
              positions: mesh.positions(),
              normals: mesh.normals(),
              faceCount: (JSON.parse(mesh.faces()) as unknown[]).length,
              coarse,
            }
          } finally {
            mesh?.free()
            mesh = undefined
          }
        }
        for (let i = 0; i < snapshots.length; i++) {
          let chunk = bodyCache.get(keys[i])
          if (!chunk) {
            try {
              chunk = tessellateBody(i, false)
            } catch (error) {
              if (!String(error).toLowerCase().includes('triangle budget')) {
                self.postMessage({
                  id: request.id,
                  error: error instanceof Error ? error.message : String(error),
                })
                continue requests
              }
              chunk = tessellateBody(i, true)
            }
          }
          chunks.push(chunk)
          cacheBody(keys[i], chunk)
          length += chunk.positions.length
          while (length > 200_000 * 9) {
            let largest = -1
            for (let j = 0; j < chunks.length; j++) {
              if (
                !chunks[j].coarse &&
                (largest === -1 ||
                  chunks[j].positions.length > chunks[largest].positions.length)
              )
                largest = j
            }
            if (largest === -1) {
              self.postMessage({
                id: request.id,
                error: 'Scene preview triangle budget exceeded',
              })
              continue requests
            }
            const coarse = tessellateBody(largest, true)
            length += coarse.positions.length - chunks[largest].positions.length
            chunks[largest] = coarse
            cacheBody(keys[largest], coarse)
          }
        }
        const positions = new Float32Array(length)
        const normals = new Float32Array(length)
        let offset = 0
        let faceCount = 0
        for (const chunk of chunks) {
          faceCount += chunk.faceCount
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
