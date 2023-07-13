import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/abstractSyntaxTreeTypes'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { updateCursors } from '../../lang/util'

export const HorzVert = ({
  horOrVert,
}: {
  horOrVert: 'vertical' | 'horizontal'
}) => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst, setCursor } =
    useStore((s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
      setCursor: s.setCursor,
    }))
  const [enableHorz, setEnableHorz] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    if (!ast) return
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(ast, pathToNode).node
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    const theTransforms = getTransformInfos(selectionRanges, ast, horOrVert)
    setTransformInfos(theTransforms)

    const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
    setEnableHorz(_enableHorz)
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={() => {
        if (!transformInfos || !ast) return
        const { modifiedAst, pathToNodeMap } = transformAstSketchLines({
          ast,
          selectionRanges,
          transformInfos,
          programMemory,
          referenceSegName: '',
        })
        updateAst(modifiedAst, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      className={`border m-1 px-1 rounded text-xs ${
        enableHorz ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enableHorz}
      title="yo dawg"
    >
      {horOrVert === 'horizontal' ? 'Horz' : 'Vert'}
    </button>
  )
}
