import {
  getMarks,
  printDeltaTotal,
  printMarkDownTable,
  printRawMarks,
} from 'lib/performance'

export function TelemetryExplorer() {
  const marks = getMarks()
  const markdownTable = printMarkDownTable(marks)
  const rawMarks = printRawMarks(marks)
  const deltaTotalTable = printDeltaTotal(marks)
  // TODO data-telemetry-type
  // TODO data-telemetry-name
  return (
    <div>
      <h1 className="pb-4">Marks</h1>
      <div className="max-w-xl max-h-64 overflow-auto select-all">
        {marks.map((mark, index) => {
          return (
            <pre className="text-xs" key={index}>
              <code key={index}>{JSON.stringify(mark, null, 2)}</code>
            </pre>
          )
        })}
      </div>
      <h1 className="pb-4">Startup Performance</h1>
      <div className="max-w-xl max-h-64 overflow-auto select-all">
        {markdownTable.map((line, index) => {
          return (
            <pre className="text-xs" key={index}>
              <code key={index}>{line}</code>
            </pre>
          )
        })}
      </div>
      <h1 className="pb-4">Delta and Totals</h1>
      <div className="max-w-xl max-h-64 overflow-auto select-all">
        {deltaTotalTable.map((line, index) => {
          return (
            <pre className="text-xs" key={index}>
              <code key={index}>{line}</code>
            </pre>
          )
        })}
      </div>
      <h1 className="pb-4">Raw Marks</h1>
      <div className="max-w-xl max-h-64 overflow-auto select-all">
        {rawMarks.map((line, index) => {
          return (
            <pre className="text-xs" key={index}>
              <code key={index}>{line}</code>
            </pre>
          )
        })}
      </div>
    </div>
  )
}
