import { historyManager } from '@src/lib/singletons'
import { useMemo, useState } from 'react'

const createReactiveHistory = (
  onChange: (key: unknown, value: unknown) => void
) =>
  new Proxy(historyManager, {
    set(_, key, value) {
      if (key === 'queue') {
        onChange(key, value) // Tell React what *actually* changed
      }
      return true
    },
  })

export function DebugHistory() {
  const historyProxy = useMemo(
    () => createReactiveHistory((key, value) => setHistory(historyManager)),
    []
  )
  const [history, setHistory] = useState(historyProxy)
  return (
    <details>
      <summary>History Debugger</summary>
      <div>
        <div className="flex gap-2 items-center">
          <p>
            {history.queue.length}
            <br />
            items
          </p>
          <p>
            {history.point}
            <br />
            indexed
          </p>
        </div>
        <div className="flex flex-col">
          {history.queue.map((item, i) => (
            <div key={item.id} className="p-1">
              <p>{item.label || 'unlabeled item'}</p>
              <small>
                item {i}: {item.id}
              </small>
            </div>
          ))}
        </div>
      </div>
    </details>
  )
}
