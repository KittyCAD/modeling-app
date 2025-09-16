import { historyManager } from '@src/lib/singletons'
import { useStack } from '@src/lib/history'

export function DebugHistory() {
  const history = useStack(historyManager)
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
            {history.cursor}
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
