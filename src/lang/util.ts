import { Selections, StoreState } from '../useStore'
import { Program } from './abstractSyntaxTree'
import { PathToNode } from './executor'
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
