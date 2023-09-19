import { useEffect } from 'react'
import { useStore } from 'useStore'

export function useEngineConnectionSubscriptions() {
  const {
    engineCommandManager,
    setCursor2,
    setHighlightRange,
    highlightRange,
  } = useStore((s) => ({
    engineCommandManager: s.engineCommandManager,
    setCursor2: s.setCursor2,
    setHighlightRange: s.setHighlightRange,
    highlightRange: s.highlightRange,
  }))
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
          setCursor2()
          return
        }
        const sourceRange = engineCommandManager.sourceRangeMap[data.entity_id]
        setCursor2({ range: sourceRange, type: 'default' })
      },
    })
    return () => {
      unSubHover()
      unSubClick()
    }
  }, [engineCommandManager, setCursor2, setHighlightRange, highlightRange])
}
