import { useStore, Selection } from '../useStore'

export function useSetCursor(sourceRange: Selection['range']) {
  const { setCursor, selectionRanges, isShiftDown } = useStore((s) => ({
    setCursor: s.setCursor,
    selectionRanges: s.selectionRanges,
    isShiftDown: s.isShiftDown,
  }))
  return () => {
    const ranges = isShiftDown
      ? [
          ...selectionRanges.codeBasedSelections.map(({ range }) => range),
          sourceRange,
        ]
      : [sourceRange]
    setCursor(ranges)
  }
}
