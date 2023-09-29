import { kclManager } from 'lang/KclSinglton'
import { getNodeFromPath, getNodePathFromSourceRange } from 'lang/queryAst'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'useStore'

export function AstExplorer() {
  const { setHighlightRange, selectionRanges } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    selectionRanges: s.selectionRanges,
  }))
  const pathToNode = getNodePathFromSourceRange(
    // TODO maybe need to have callback to make sure it stays in sync
    kclManager.ast,
    selectionRanges.codeBasedSelections?.[0]?.range
  )
  const node = getNodeFromPath(kclManager.ast, pathToNode).node
  const [filterKeys, setFilterKeys] = useState<string[]>(['start', 'end'])

  return (
    <div className="relative" style={{ width: '300px' }}>
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
          setHighlightRange([0, 0])
        }}
      >
        <pre className=" text-xs overflow-y-auto" style={{ width: '300px' }}>
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
  const { setHighlightRange, setCursor2 } = useStore((s) => ({
    setHighlightRange: s.setHighlightRange,
    setCursor2: s.setCursor2,
  }))
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
        hasCursor ? 'bg-violet-100/25' : ''
      }`}
      onMouseEnter={(e) => {
        setHighlightRange([obj?.start || 0, obj.end])
        e.stopPropagation()
      }}
      onMouseMove={(e) => {
        e.stopPropagation()
        setHighlightRange([obj?.start || 0, obj.end])
      }}
      onClick={(e) => {
        setCursor2({ type: 'default', range: [obj?.start || 0, obj.end || 0] })
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
            })}
          </ul>
        </span>
      )}
    </pre>
  )
}
