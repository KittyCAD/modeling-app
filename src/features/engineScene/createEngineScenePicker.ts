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

    /**
     * Which curve made each face of a swept solid.
     *
     * The response is one entry per face: the face's own id, the curve it was
     * swept from, and whether it is a cap. kcl-lib builds wall artifacts from
     * exactly this, setting each wall's segment to the curve reported here — so
     * this is the engine's version of something the graph usually already knows,
     * and worth asking only when the graph's answer is unusable.
     */
    async sweptFaces(solidId: string) {
      if (!ready.peek()) return []

      try {
        const bytes = await getConnection().sendCommand({
          type: 'solid3d_get_extrusion_face_info',
          object_id: solidId,
        })

        const message = msgpackDecode(bytes) as {
          resp?: {
            data?: {
              modeling_response?: {
                type?: string
                data?: {
                  faces?: {
                    face_id?: string | null
                    curve_id?: string | null
                    cap?: string
                  }[]
                }
              }
            }
          }
        }

        const response = message.resp?.data?.modeling_response
        if (response?.type !== 'solid3d_get_extrusion_face_info') return []

        return (response.data?.faces ?? []).flatMap((face) =>
          face.face_id
            ? [
                {
                  face: face.face_id,
                  curve: face.curve_id ?? null,
                  // Normalised here rather than trusted: the engine's enum is
                  // its own, and a value we do not know means "not an end".
                  cap: (['top', 'bottom', 'both'] as const).includes(
                    face.cap as 'top'
                  )
                    ? (face.cap as 'top' | 'bottom' | 'both')
                    : ('none' as const),
                },
              ]
            : []
        )
      } catch {
        // Not a swept solid, or a solid the engine has forgotten. Either way the
        // question does not apply.
        return []
      }
    },

    /**
     * The uuid of a solid's nth face.
     *
     * The same command KCL's `faceId(body, index = n)` sends when it runs, which
     * is what makes an index worth writing down: asking it here confirms that the
     * index means the face under the pointer, rather than hoping an ordering
     * happens to line up.
     */
    async faceUuid(solidId: string, index: number) {
      if (!ready.peek()) return null

      try {
        const bytes = await getConnection().sendCommand({
          type: 'solid3d_get_face_uuid',
          object_id: solidId,
          face_index: index,
        })

        const message = msgpackDecode(bytes) as {
          resp?: {
            data?: {
              modeling_response?: {
                type?: string
                data?: { face_id?: string | null }
              }
            }
          }
        }

        const response = message.resp?.data?.modeling_response
        if (response?.type !== 'solid3d_get_face_uuid') return null

        return response.data?.face_id ?? null
      } catch {
        // An index the solid does not have, which is an answer too.
        return null
      }
    },

    /**
     * Ask the engine how an area would be written as a region.
     *
     * `region_get_resolvable_intersection_info` answers with the two curves that
     * border the area and how they meet — the walking curve, the curve that
     * crosses it, which crossing, and whether the area is inside the clockwise
     * turn. That is `region`'s argument list, in the engine's vocabulary.
     *
     * A failure is an answer: the command rejects for an entity that is not a
     * region, and asking is how we find out. Which is why this is only called
     * when the artifact graph could not name the entity — otherwise every click
     * on a face would pay for a question with a known answer.
     */
    async describeRegion(entityId: string) {
      if (!ready.peek()) return null

      try {
        const bytes = await getConnection().sendCommand({
          type: 'region_get_resolvable_intersection_info',
          region_id: entityId,
        })

        const message = msgpackDecode(bytes) as {
          resp?: {
            data?: {
              modeling_response?: {
                type?: string
                data?: {
                  segment?: string
                  intersection_segment?: string
                  intersection_index?: number
                  intersection_count?: number
                  curve_clockwise?: boolean
                }
              }
            }
          }
        }

        const response = message.resp?.data?.modeling_response
        if (response?.type !== 'region_get_resolvable_intersection_info') {
          return null
        }

        const data = response.data
        if (!data?.segment || !data.intersection_segment) return null

        return {
          segmentIds: [data.segment, data.intersection_segment],
          intersectionIndex: data.intersection_index ?? 0,
          intersectionCount: data.intersection_count ?? 1,
          clockwise: data.curve_clockwise ?? false,
        }
      } catch {
        // Not a region. Nothing is wrong; the question simply does not apply.
        return null
      }
    },
  }
}
