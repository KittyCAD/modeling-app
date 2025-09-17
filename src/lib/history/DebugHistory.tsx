import { historyManager } from '@src/lib/singletons'
import { useHistory, useStack } from '@src/lib/history/lib'

export function DebugHistory() {
  const historySnapshot = useHistory(historyManager)
  const stackSnapshot = useStack(historySnapshot.currentStack)
  return (
    <details>
      <summary>History Debugger</summary>
      <div>
        <div className="flex gap-2 items-center">
          <p>
            {historySnapshot.currentStackId}
            <br />
            current stack
          </p>
          <p>
            {stackSnapshot.queue.length}
            <br />
            items
          </p>
          <p>
            {stackSnapshot.cursor}
            <br />
            indexed
          </p>
        </div>
        <div className="flex flex-col">
          {stackSnapshot.queue.map((item, i) => (
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
