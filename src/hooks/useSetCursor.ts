import { useStore, Range } from '../useStore'

export function useSetCursor(sourceRange: Range) {
  const { setCursor, selectionRanges, isShiftDown } = useStore((s) => ({
    setCursor: s.setCursor,
    selectionRanges: s.selectionRanges,
    isShiftDown: s.isShiftDown,
  }))
  return () => {
    const ranges = isShiftDown
      ? [...selectionRanges, sourceRange]
      : [sourceRange]
    setCursor(ranges)
  }
}
