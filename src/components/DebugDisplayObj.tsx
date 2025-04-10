import { useRef, useState } from 'react'

import { isArray, isNonNullable } from '@src/lib/utils'

type Primitive = string | number | bigint | boolean | symbol | null | undefined

export type GenericObj = {
  type?: string
  [key: string]: GenericObj | Primitive | Array<GenericObj | Primitive>
}

/**
 * Display an array of objects or primitives for debug purposes. Nullable values
 * are displayed so that relative indexes are preserved.
 */
export function DebugDisplayArray({
  arr,
  filterKeys,
}: {
  arr: Array<GenericObj | Primitive>
  filterKeys: string[]
}) {
  return (
    <>
      {arr.map((obj, index) => {
        return (
          <div className="my-2" key={index}>
            {obj && typeof obj === 'object' ? (
              <DebugDisplayObj obj={obj} filterKeys={filterKeys} />
            ) : isNonNullable(obj) ? (
              <span>{obj.toString()}</span>
            ) : (
              <span>{obj}</span>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * Display an object as a tree for debug purposes. Nullable values are omitted.
 * The only other property treated specially is the type property, which is
 * assumed to be a string.
 */
export function DebugDisplayObj({
  obj,
  filterKeys,
}: {
  obj: GenericObj
  filterKeys: string[]
}) {
  const ref = useRef<HTMLPreElement>(null)
  const hasCursor = false
  const [isCollapsed, setIsCollapsed] = useState(false)
  return (
    <pre
      ref={ref}
      className={`ml-2 border-l border-violet-600 pl-1 ${
        hasCursor ? 'bg-violet-100/80 dark:bg-violet-100/25' : ''
      }`}
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
          <button
            className="m-0 p-0 border-0 mb-auto"
            onClick={() => setIsCollapsed(true)}
          >
            {'⬇️'}
          </button>
          <ul className="inline-block">
            {Object.entries(obj).map(([key, value]) => {
              if (filterKeys.includes(key)) {
                return null
              } else if (isArray(value)) {
                return (
                  <li key={key}>
                    {`${key}: [`}
                    <DebugDisplayArray arr={value} filterKeys={filterKeys} />
                    {']'}
                  </li>
                )
              } else if (typeof value === 'object' && value !== null) {
                return (
                  <li key={key}>
                    {key}:
                    <DebugDisplayObj obj={value} filterKeys={filterKeys} />
                  </li>
                )
              } else if (isNonNullable(value)) {
                return (
                  <li key={key}>
                    {key}: {value.toString()}
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
