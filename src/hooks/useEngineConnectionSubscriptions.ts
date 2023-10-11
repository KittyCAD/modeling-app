import { useEffect } from 'react'
import { useStore } from 'useStore'
import { engineCommandManager } from '../lang/std/engineConnection'
import { useModelingContext } from './useModelingContext'

export function useEngineConnectionSubscriptions() {
  const { setHighlightRange, highlightRange } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    highlightRange: s.highlightRange,
  }))
  const { send } = useModelingContext()
  useEffect(() => {
    if (!engineCommandManager) return

    const unSubHover = engineCommandManager.subscribeToUnreliable({
      event: 'highlight_set_entity',
      callback: ({ data }) => {
        if (data?.entity_id) {
          const sourceRange =
            engineCommandManager.sourceRangeMap[data.entity_id]
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
        const sourceRange = engineCommandManager.sourceRangeMap[data.entity_id]
        send({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: { range: sourceRange, type: 'default' },
          },
        })
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, setHighlightRange, highlightRange])
}
