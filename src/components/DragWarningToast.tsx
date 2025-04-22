import type { MoveDesc } from '@src/machines/modelingMachine'

export const DragWarningToast = (moveDescs: MoveDesc[]) => {
  if (moveDescs.length === 1) {
    return (
      <div className="flex items-center">
        <div>🔒</div>
        <div className="dark:bg-slate-950/50 bg-slate-400/50 p-1 px-3 rounded-xl text-sm">
          move disabled: line{' '}
          <span className="dark:text-energy-20 text-lime-600">
            {moveDescs[0].line}
          </span>
          :{' '}
          <pre>
            <code className="dark:text-energy-20 text-lime-600">
              {moveDescs[0].snippet}
            </code>
          </pre>{' '}
          is fully constrained
        </div>
      </div>
    )
  } else if (moveDescs.length > 1) {
    return (
      <div className="dark:bg-slate-950/50 bg-slate-400/50 p-1 px-3 rounded-xl text-sm">
        <div>Move disabled as The following lines are constrained</div>
        {moveDescs.map((desc, i) => {
          return (
            <div key={i}>
              line {desc.line}:{' '}
              <pre className="inline-block">
                <code className="dark:text-energy-20 text-lime-600">
                  {moveDescs[0].snippet}
                </code>
              </pre>{' '}
            </div>
          )
        })}
      </div>
    )
  }
  return null
}
