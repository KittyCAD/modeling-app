import { useEffect } from 'react'
import { useStore } from 'useStore'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from './useModelingContext'
import { v4 as uuidv4 } from 'uuid'
import { SourceRange } from 'lang/wasm'

export function useEngineConnectionSubscriptions() {
  const { setHighlightRange, highlightRange } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    highlightRange: s.highlightRange,
  }))
  const { send, context } = useModelingContext()

  interface RangeAndId {
    id: string
    range: SourceRange
  }

  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const sourceRange =
            engineCommandManager.artifactMap?.[data.entity_id]?.range
          setHighlightRange(sourceRange)
        } else if (
          !highlightRange ||
          (highlightRange[0] !== 0 && highlightRange[1] !== 0)
        ) {
          setHighlightRange([0, 0])
        }
      },
    })
    const unSubClick = engineCommandManager.subscribeTo({
      event: 'select_with_point',
      callback: ({ data }) => {
        if (!data?.entity_id) {
          send({
            type: 'Set selection',
            data: { selectionType: 'singleCodeCursor' },
          })
          return
        }
        const sourceRange =
          engineCommandManager.artifactMap[data.entity_id]?.range
        if (engineCommandManager.artifactMap[data.entity_id]) {
          send({
            type: 'Set selection',
            data: {
              selectionType: 'singleCodeCursor',
              selection: { range: sourceRange, type: 'default' },
            },
          })
        } else {
          // selected a vertex
          engineCommandManager
            .sendSceneCommand({
              type: 'modeling_cmd_req',
              cmd_id: uuidv4(),
              cmd: {
                type: 'path_get_curve_uuids_for_vertices',
                vertex_ids: [data.entity_id],
                path_id: context.sketchEnginePathId,
              },
            })
            .then((res) => {
              const curveIds = res?.data?.data?.curve_ids
              const ranges: RangeAndId[] = curveIds
                .map(
                  (id: string): RangeAndId => ({
                    id,
                    range: engineCommandManager.artifactMap[id].range,
                  })
                )
                .sort((a: RangeAndId, b: RangeAndId) => a.range[0] - b.range[0])
              // default to the head of the curve selected
              const _sourceRange = ranges?.[0].range
              const artifact = engineCommandManager.artifactMap[ranges?.[0]?.id]
              if (artifact.type === 'result') {
                artifact.headVertexId = data.entity_id
              }
              send({
                type: 'Set selection',
                data: {
                  selectionType: 'singleCodeCursor',
                  // line-end is used to indicate that headVertexId should be sent to the engine as "selected"
                  // not the whole curve
                  selection: { range: _sourceRange, type: 'line-end' },
                },
              })
            })
        }
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [
    engineCommandManager,
    setHighlightRange,
    highlightRange,
    context.sketchEnginePathId,
  ])
}
