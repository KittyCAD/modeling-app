import { type ReadonlySignal, computed } from '@preact/signals'
import { decode as msgpackDecode } from '@msgpack/msgpack'
import type { EngineConnection } from '@src/contracts/engine'
import type { ScenePoint } from '@src/contracts/scene'
import type { ScenePicker } from '@src/contracts/selection'
import { toStreamWindow } from '@src/features/engineScene/streamWindow'

/**
 * What the engine says is under a point.
 *
 * `select_with_point` is the engine's own selection command: it answers with the
 * entity's uuid *and* highlights it, so nothing here has to render a highlight.
 * That is why the mode travels to the engine rather than being applied locally —
 * the engine owns what is lit up, and a local-only notion of "added to the
 * selection" would show one thing and mean another.
 *
 * The first thing in this app to read a response rather than fire and forget.
 * The connection decodes each message to route it and then re-encodes for the
 * Rust side, which needs msgpack, so a TS caller decodes once more. Cheap, and
 * the alternative — handing back a decoded object — would make the connection
 * choose a shape for two consumers that want different ones.
 */
export function createEngineScenePicker(
  /** Lazy: resolving a service while the registry graph is built is not allowed. */
  getConnection: () => EngineConnection
): ScenePicker {
  const ready: ReadonlySignal<boolean> = computed(
    () => getConnection().state.value.status === 'connected'
  )

  return {
    id: 'engine',
    ready,

    async pick(at: ScenePoint) {
      if (!ready.peek()) return null

      const connection = getConnection()
      const bytes = await connection.sendCommand({
        type: 'select_with_point',
        selected_at_window: toStreamWindow(at, connection.viewportSize.peek()),
        // Always `replace` to the engine. Adding and removing are decided here,
        // against what is already selected, and then the whole set is restated —
        // otherwise the engine's idea of the selection and ours drift apart.
        selection_type: 'replace',
      })

      const message = msgpackDecode(bytes) as {
        resp?: {
          data?: {
            modeling_response?: { type?: string; data?: { entity_id?: string } }
          }
        }
      }

      const response = message.resp?.data?.modeling_response
      if (response?.type !== 'select_with_point') return null

      // Absent rather than empty for a click on nothing, which is the engine's
      // way of saying the ray hit no geometry.
      return response.data?.entity_id ?? null
    },
  }
}
