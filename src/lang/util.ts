import { Selections, StoreState } from '../useStore'
import { Program, PathToNode } from './wasm'
import { getNodeFromPath } from './queryAst'

export function pathMapToSelections(
  ast: Program,
  prevSelections: Selections,
  pathToNodeMap: { [key: number]: PathToNode }
): Selections {
  const newSelections: Selections = {
    ...prevSelections,
    codeBasedSelections: [],
  }
  Object.entries(pathToNodeMap).forEach(([index, path]) => {
    const node = getNodeFromPath(ast, path).node as any
    const type = prevSelections.codeBasedSelections[Number(index)].type
    if (node) {
      newSelections.codeBasedSelections.push({
        range: [node.start, node.end],
        type: type || 'default',
      })
    }
  })
  return newSelections
}

export function isReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    // TODO/Note I (Kurt) think '(prefers-reduced-motion: reduce)' and '(prefers-reduced-motion)' are equivalent, but not 100% sure
    window.matchMedia('(prefers-reduced-motion)').matches
  )
}
