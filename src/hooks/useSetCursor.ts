import { useStore, Selection, Selections } from '../useStore'

export function useSetCursor(
  sourceRange: Selection['range'],
  type: Selection['type'] = 'default'
) {
  const { setCursor, selectionRanges, isShiftDown } = useStore((s) => ({
    setCursor: s.setCursor,
    selectionRanges: s.selectionRanges,
    isShiftDown: s.isShiftDown,
  }))
  return () => {
    const selections: Selections = {
      ...selectionRanges,
      codeBasedSelections: isShiftDown
        ? [...selectionRanges.codeBasedSelections, { range: sourceRange, type }]
        : [{ range: sourceRange, type }],
    }
    setCursor(selections)
  }
}
