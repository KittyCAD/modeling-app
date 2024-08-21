import { useModelingContext } from 'hooks/useModelingContext'
import { editorManager, kclManager } from 'lib/singletons'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { useEffect, useRef, useState } from 'react'
import { trap } from 'lib/trap'

export function AstExplorer() {
  const { context } = useModelingContext()
  const pathToNode = getNodePathFromSourceRange(
    // TODO maybe need to have callback to make sure it stays in sync
    kclManager.ast,
    context.selectionRanges.codeBasedSelections?.[0]?.range
  )
  const [filterKeys, setFilterKeys] = useState<string[]>(['start', 'end'])

  const _node = getNodeFromPath(kclManager.ast, pathToNode)
  if (trap(_node)) return
  const node = _node

  return (
    <div id="ast-explorer" className="relative">
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
          editorManager.setHighlightRange([[0, 0]])
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
    </div>
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
        editorManager.setHighlightRange([[obj?.start || 0, obj.end]])
        e.stopPropagation()
      }}
      onMouseMove={(e) => {
        e.stopPropagation()
        editorManager.setHighlightRange([[obj?.start || 0, obj.end]])
      }}
      onClick={(e) => {
        send({
          type: 'Set selection',
          data: {
            selectionType: 'singleCodeCursor',
            selection: {
              type: 'default',
              range: [obj?.start || 0, obj.end || 0],
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
              } else if (Array.isArray(value)) {
                return (
                  <li key={key}>
                    {`${key}: [`}
                    <DisplayBody
                      body={value}
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
