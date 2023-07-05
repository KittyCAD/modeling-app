import { useEffect, useState } from 'react'
import { useStore } from '../../useStore'
import {
  getNodePathFromSourceRange,
  getNodeFromPath,
} from '../../lang/queryAst'
import { Literal, Value } from '../../lang/abstractSyntaxTree'
import { createCallExpression } from '../../lang/modifyAst'

export const WrapInSin = () => {
  const { guiMode, selectionRanges, ast, programMemory, updateAst } = useStore(
    (s) => ({
      guiMode: s.guiMode,
      ast: s.ast,
      updateAst: s.updateAst,
      selectionRanges: s.selectionRanges,
      programMemory: s.programMemory,
    })
  )
  const [enable, setEnable] = useState(false)

  useEffect(() => {
    if (!ast) return
    const range = selectionRanges.codeBasedSelections?.[0]?.range || []
    const path = getNodePathFromSourceRange(ast, range)
    const { node: value } = getNodeFromPath<Value>(ast, path, ['literal'])
    const isLiteral = value.type === 'Literal'
    console.log('value', value)
    if (!isLiteral) {
      setEnable(false)
      return
    }
    setEnable(true)
  }, [guiMode, selectionRanges])

  const onClick = () => {
    if (!ast) return
    const modifiedAst = JSON.parse(JSON.stringify(ast))
    const range = selectionRanges.codeBasedSelections?.[0]?.range || []

    // check if node at range is a literal
    const path = getNodePathFromSourceRange(ast, range)
    const { node: value, deepPath } = getNodeFromPath<Literal>(
      modifiedAst,
      path,
      ['literal']
    )
    const callExpression = createCallExpression('sin', [value])
    // replace literal with callExpression
    const last = deepPath[deepPath.length - 1]
    const startPath = deepPath.slice(0, -1)
    const nodeToReplace = getNodeFromPath(modifiedAst, startPath).node as any
    nodeToReplace[last[0]] = callExpression

    updateAst(modifiedAst)
  }

  return (
    <button
      className={`border m-1 px-1 rounded text-xs ${
        enable ? 'bg-gray-50 text-gray-800' : 'bg-gray-200 text-gray-400'
      }`}
      disabled={!enable}
      onClick={onClick}
    >
      wrapLiteralInSin
    </button>
  )
}
