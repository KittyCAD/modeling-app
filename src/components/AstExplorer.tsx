import { useEffect, useRef, useState } from 'react'

import { useModelingContext } from '@src/hooks/useModelingContext'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { defaultSourceRange, topLevelRange } from '@src/lang/wasm'
import { codeToIdSelections } from '@src/lib/selections'
import { editorManager, kclManager } from '@src/lib/singletons'
import { trap } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'

export function AstExplorer() {
  const { context } = useModelingContext()
  const pathToNode = getNodePathFromSourceRange(
    // TODO maybe need to have callback to make sure it stays in sync
    kclManager.ast,
    context.selectionRanges.graphSelections?.[0]?.codeRef?.range
  )
  const [filterKeys, setFilterKeys] = useState<string[]>(['start', 'end'])

  const _node = getNodeFromPath(kclManager.ast, pathToNode)
  if (trap(_node)) return
  const node = _node

  return (
    <details id="ast-explorer" className="relative">
      <summary>AST Explorer</summary>
      <div className="">
        filter out keys:<div className="w-2 inline-block"></div>
        {['start', 'end', 'type'].map((key) => {
          return (
            <label key={key} className="inline-flex items-center">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={filterKeys.includes(key)}
                onChange={(e) => {
                  if (filterKeys.includes(key)) {
                    setFilterKeys(filterKeys.filter((k) => k !== key))
                  } else {
                    setFilterKeys([...filterKeys, key])
                  }
                }}
              />
              <span className="mr-2">{key}</span>
            </label>
          )
        })}
      </div>
      <div
        className="h-full relative"
        onMouseLeave={(e) => {
          editorManager.setHighlightRange([defaultSourceRange()])
        }}
      >
        <pre className="text-xs">
          <DisplayObj
            obj={kclManager.ast}
            filterKeys={filterKeys}
            node={node}
          />
        </pre>
      </div>
    </details>
  )
}

function DisplayBody({
  body,
  filterKeys,
  node,
}: {
  body: { start: number; end: number; [key: string]: any }[]
  filterKeys: string[]
  node: any
}) {
  return (
    <>
      {body.map((b, index) => {
        return (
          <div className="my-2" key={index}>
            <DisplayObj obj={b} filterKeys={filterKeys} node={node} />
          </div>
        )
      })}
    </>
  )
}

function DisplayObj({
  obj,
  filterKeys,
  node,
}: {
  obj: { start: number; end: number; [key: string]: any }
  filterKeys: string[]
  node: any
}) {
  const { send } = useModelingContext()
  const ref = useRef<HTMLPreElement>(null)
  const [hasCursor, setHasCursor] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  useEffect(() => {
    if (
      node?.start === obj?.start &&
      node?.end === obj?.end &&
      node.type === obj?.type
    ) {
      ref?.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      setHasCursor(true)
    } else {
      setHasCursor(false)
    }
  }, [node.start, node.end, node.type])

  return (
    <pre
      ref={ref}
      className={`ml-2 border-l border-violet-600 pl-1 ${
        hasCursor ? 'bg-violet-100/80 dark:bg-violet-100/25' : ''
      }`}
      onMouseEnter={(e) => {
        editorManager.setHighlightRange([
          topLevelRange(obj?.start || 0, obj.end),
        ])
        e.stopPropagation()
      }}
      onMouseMove={(e) => {
        e.stopPropagation()
        editorManager.setHighlightRange([
          topLevelRange(obj?.start || 0, obj.end),
        ])
      }}
      onClick={(e) => {
        const range = topLevelRange(obj?.start || 0, obj.end || 0)
        const idInfo = codeToIdSelections(
          [{ codeRef: codeRefFromRange(range, kclManager.ast) }],
          kclManager.artifactGraph,
          kclManager.artifactIndex
        )[0]
        const artifact = kclManager.artifactGraph.get(idInfo?.id || '')
        if (!artifact) return
        send({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: {
              artifact: artifact,
              codeRef: codeRefFromRange(range, kclManager.ast),
            },
          },
        })
        e.stopPropagation()
      }}
    >
      {isCollapsed ? (
        <button
          className="m-0 p-0 border-0"
          onClick={() => setIsCollapsed(false)}
        >
          {'>'}type: {obj.type}
        </button>
      ) : (
        <span className="flex">
          {/* <button className="m-0 p-0 border-0 mb-auto" onClick={() => setIsCollapsed(true)}>{'⬇️'}</button> */}
          <ul className="inline-block">
            {Object.entries(obj).map(([key, value]) => {
              if (filterKeys.includes(key)) {
                return null
              } else if (isArray(value)) {
                return (
                  <li key={key}>
                    {`${key}: [`}
                    <DisplayBody
                      body={value as any}
                      filterKeys={filterKeys}
                      node={node}
                    />
                    {']'}
                  </li>
                )
              } else if (
                typeof value === 'object' &&
                value !== null &&
                value?.end
              ) {
                return (
                  <li key={key}>
                    {key}:
                    <DisplayObj
                      obj={value}
                      filterKeys={filterKeys}
                      node={node}
                    />
                  </li>
                )
              } else if (
                typeof value === 'string' ||
                typeof value === 'number'
              ) {
                return (
                  <li key={key}>
                    {key}: {value}
                  </li>
                )
              }
              return null
            })}
          </ul>
        </span>
      )}
    </pre>
  )
}
