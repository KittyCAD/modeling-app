import { Selections, StoreState } from '../useStore'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'

export function updateCursors(
  setCursor: StoreState['setCursor'],
  selectionRanges: Selections,
  pathToNodeMap: { [key: number]: PathToNode }
): (newAst: Program) => void {
  return (newAst: Program) => {
    const newSelections: Selections = {
      ...selectionRanges,
      codeBasedSelections: [],
    }
    Object.entries(pathToNodeMap).forEach(([index, path]) => {
      const node = getNodeFromPath(newAst, path).node as any
      const type = selectionRanges.codeBasedSelections[Number(index)].type
      if (node) {
        newSelections.codeBasedSelections.push({
          range: [node.start, node.end],
          type: type || 'default',
        })
      }
    })
    setCursor(newSelections)
  }
}

export function isReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    // TODO/Note I (Kurt) think '(prefers-reduced-motion: reduce)' and '(prefers-reduced-motion)' are equivalent, but not 100% sure
    window.matchMedia('(prefers-reduced-motion)').matches
  )
}
