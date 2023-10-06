import { useState, useEffect } from 'react'
import { toolTips, useStore } from '../../useStore'
import { Program, ProgramMemory, Value } from '../../lang/wasm'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import {
  PathToNodeMap,
  TransformInfo,
  getTransformInfos,
  transformAstSketchLines,
} from '../../lang/std/sketchcombos'
import { updateCursors } from '../../lang/util'
import { ActionIcon } from 'components/ActionIcon'
import { sketchButtonClassnames } from 'Toolbar'
import { kclManager } from 'lang/KclSinglton'
import { Selections } from 'useStore'
import { useModelingContext } from 'hooks/useModelingContext'

export const HorzVert = ({
  horOrVert,
}: {
  horOrVert: 'vertical' | 'horizontal'
}) => {
  const { guiMode, selectionRanges, setCursor } = useStore((s) => ({
    guiMode: s.guiMode,
    selectionRanges: s.selectionRanges,
    setCursor: s.setCursor,
  }))
  const [enableHorz, setEnableHorz] = useState(false)
  const [transformInfos, setTransformInfos] = useState<TransformInfo[]>()
  const { context } = useModelingContext()
  useEffect(() => {
    const { enabled, transforms } = horzVertInfo(selectionRanges, horOrVert)
    setTransformInfos(transforms)
    setEnableHorz(enabled)
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
        kclManager.updateAst(context.defaultPlanes.planes, modifiedAst, true, {
          callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
        })
      }}
      disabled={!enableHorz}
      className="group"
      title={horOrVert === 'horizontal' ? 'Horizontal' : 'Vertical'}
    >
      <ActionIcon
        icon={horOrVert === 'horizontal' ? 'horizontal' : 'vertical'}
        className="!p-0.5"
        bgClassName={sketchButtonClassnames.background}
        iconClassName={sketchButtonClassnames.icon}
        size="md"
      />
      {horOrVert === 'horizontal' ? 'Horizontal' : 'Vertical'}
    </button>
  )
}

export function horzVertInfo(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal'
) {
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

  const theTransforms = getTransformInfos(
    selectionRanges,
    kclManager.ast,
    horOrVert
  )
  const _enableHorz = isAllTooltips && theTransforms.every(Boolean)
  return { enabled: _enableHorz, transforms: theTransforms }
}

export function applyConstraintHorzVert(
  selectionRanges: Selections,
  horOrVert: 'vertical' | 'horizontal',
  ast: Program,
  programMemory: ProgramMemory
): {
  modifiedAst: Program
  pathToNodeMap: PathToNodeMap
} {
  const transformInfos = horzVertInfo(selectionRanges, horOrVert).transforms
  return transformAstSketchLines({
    ast,
    selectionRanges,
    transformInfos,
    programMemory,
    referenceSegName: '',
  })
  // kclManager.updateAst(modifiedAst, true, {
  //   callBack: updateCursors(setCursor, selectionRanges, pathToNodeMap),
  // })
}
