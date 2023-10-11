import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  TransformInfo,
  getRemoveConstraintsTransforms,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { kclManager } from 'lang/KclSinglton'

/*
export const RemoveConstrainingValues = () => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enableHorz, setEnableHorz] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  useEffect(() => {
    const paths = selectionRanges.codeBasedSelections.map(({ range }) =>
      getNodePathFromSourceRange(kclManager.ast, range)
    )
    const nodes = paths.map(
      (pathToNode) => getNodeFromPath<Value>(kclManager.ast, pathToNode).node
    )
    const isAllTooltips = nodes.every(
      (node) =>
        node?.type === 'CallExpression' &&
        toolTips.includes(node.callee.name as any)
    )

    try {
      const theTransforms = getRemoveConstraintsTransforms(
        selectionRanges,
        kclManager.ast,
        'removeConstrainingValues'
      )
      setTransformInfos(theTransforms)

      const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
      setEnableHorz(_enableHorz)
    } catch (e) {
      console.error(e)
    }
  }, [guiMode, selectionRanges])
  if (guiMode.mode !== 'sketch') return null

  return (
    <button
      onClick={() => {
        if (!transformInfos) return
        const { modifiedAst, pathToNodeMap } = transformAstSketchLines({
          ast: kclManager.ast,
          selectionRanges,
          transformInfos,
          programMemory: kclManager.programMemory,
          referenceSegName: '',
        })
        kclManager.updateAst(modifiedAst, true, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      disabled={!enableHorz}
      title="Remove Constraining Values"
    >
      Remove Constraining Values
    </button>
  )
}
*/
