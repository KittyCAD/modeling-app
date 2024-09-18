// Get the longest width of values or column name
function columnWidth(arr:{[key:string]: any}, key:string) : number {
  // Default as the column name
  let maxLength = key.length

  // for each value of that key, check if the length is longer
  arr.forEach((value : any) => {
    const valueAsString = String(value[key])
    maxLength =
      valueAsString.length > maxLength ? valueAsString.length : maxLength
  })
  return maxLength
}

function printHeader(columnWidths: MaxWidth) : string {
  const headers = ['|']
  const padLeft = ' '
  Object.keys(columnWidths).forEach((key) => {
    const maxWidth = columnWidths[key]
    const padLength = maxWidth - key.length
    const paddingRight = ' '.repeat(padLength + 1)
    headers.push(padLeft, key, paddingRight, '|')
  })
  return headers.join('')
}

function printDivider(columnWidths: MaxWidth) : string {
  const headers = ['|']
  const padLeft = ' '
  Object.keys(columnWidths).forEach((key) => {
    const keyMaxLength = columnWidths[key]
    const dashedLines = '-'.repeat(keyMaxLength)
    headers.push(padLeft, dashedLines, ' ', '|')
  })
  return headers.join('')
}

function printRow(row:{[key:string]: any}, columnWidths: MaxWidth) : string {
  const _row = ['|']
  const padLeft = ' '
  Object.keys(row).forEach((key) => {
    const value = String(row[key])
    const valueLength = value && value.length ? value.length : 0
    const padLength = columnWidths[key] - valueLength
    const paddingRight = ' '.repeat(padLength + 1)
    _row.push(padLeft, value, paddingRight, '|')
  })
  return _row.join('')
}

interface MaxWidth {
  [key: string]:number
}

export function printMarkDownTable(marks: Array<{[key:string]:any}>) : Array<string> {
  if (marks.length === 0) {
    return []
  }
  const sample = marks[0]
  const columnWidths : MaxWidth = {}
  Object.keys(sample).forEach((key) => {
    const width = columnWidth(marks, key)
    columnWidths[key] = width
  })

  const lines = []
  lines.push(printHeader(columnWidths))
  lines.push(printDivider(columnWidths))
  marks.forEach((row) => {
    lines.push(printRow(row, columnWidths))
  })
  return lines
}

interface PerformanceDeltaTotal {
  name: string
  startTime: number
  delta: string
  total: string
}

function computeDeltaTotal(marks: Array<PerformanceMark>) : Array<PerformanceDeltaTotal> {
  let startTime = -1
  let total = 0
  const deltaTotalArray : Array<PerformanceDeltaTotal>= marks.map((row : PerformanceMark) => {
    const delta =
      startTime === -1 ? 0 : Number(row.startTime) - Number(startTime)
    startTime = row.startTime
    total += delta
    const formatted : PerformanceDeltaTotal = {
      name: row.name,
      startTime: row.startTime,
      delta: delta.toFixed(2),
      total: total.toFixed(2),
    }
    return formatted
  })
  return deltaTotalArray
}

export function printDeltaTotal(marks: Array<PerformanceMark>) : string[] {
  const deltaTotalArray = computeDeltaTotal(marks)
  return printMarkDownTable(deltaTotalArray)
}

function printRawRow(row: {[key:string]: any}) : string {
  const _row = ['']
  Object.keys(row).forEach((key) => {
    const value = String(row[key])
    _row.push(value, ' ')
  })
  return _row.join('')
}

export function printRawMarks(marks: Array<PerformanceMark>) : string[] {
  const headers = ['Name', 'Timestamp', 'Delta', 'Total', 'Detail']
  const lines = ['```', headers.join(' ')]
  const deltaTotalArray = computeDeltaTotal(marks)
  deltaTotalArray.forEach((row) => {
    lines.push(printRawRow(row))
  })
  lines.push('```')
  return lines
}

export function printInvocationCount(marks: Array<PerformanceMark>) : string[] {
  const counts: {[key:string]: number} = {}
  marks.forEach((mark : PerformanceMark) => {
    counts[mark.name] =
      counts[mark.name] === undefined ? 1 : counts[mark.name] + 1
  })

  const formattedCounts = Object.entries(counts).map((entry) => {
    return {
      name: entry[0],
      count: entry[1],
    }
  })
  return printMarkDownTable(formattedCounts)
}

function isWeb() : boolean {
  // Identify browser environment when following property is not present
  // https://nodejs.org/dist/latest-v16.x/docs/api/perf_hooks.html#performancenodetiming
  return (
    typeof performance === 'object' &&
    typeof performance.mark === 'function' &&
    // @ts-ignore
    !performance.nodeTiming
  )
}

function isNode() : boolean {
  // @ts-ignore
  return typeof process === 'object' && performance.nodeTiming
}

function getRuntime() : string {
  if (isNode()) {
    return 'nodejs'
  } else if (isWeb()) {
    return 'web'
  }
  return 'runtime unknown, could not detect'
}

interface PerformanceMarkDetail {
  [key: string] : any
}

interface PerformanceMark {
  name: string,
  startTime: number,
  entryType: string,
  detail: null | PerformanceMarkDetail,
  duration?: number
}

interface MarkHelpers {
  mark( name: string, options?: PerformanceMark): void,
  markOnce(name: string, options?: PerformanceMark): void,
  getMarks(): PerformanceMark[]
}

/**
 * Detect performance API environment, either Web or Node.js
 */
function detectEnvironment() : MarkHelpers {
  const seenMarks : {  [key: string]: boolean} = {}
  if (isWeb() || isNode()) {
    // in a browser context, reuse performance-util
    // https://developer.mozilla.org/en-US/docs/Web/API/Performance
    
    function _mark (name: string, options?: PerformanceMark) {
      const _options = {
        ...options,
      }

      if (!_options.detail) {
        _options.detail = {}
      }
      _options.detail.runtime = getRuntime()

      performance.mark(name, _options)
    }

    const _helpers : MarkHelpers=  {
      mark(name: string, options?: PerformanceMark) {
        _mark(name, options)
      },
      markOnce(name: string, options?: PerformanceMark) {
        if (seenMarks[name]) {
          return
        }
        _mark(name, options)
        seenMarks[name] = true
      },
      getMarks() {
        let timeOrigin = performance.timeOrigin
        const result : PerformanceMark[] = [
          {
            name: 'code/timeOrigin',
            startTime: Math.round(timeOrigin),
            detail: { runtime: getRuntime() },
            entryType: 'mark',
          },
        ]
        for (const entry of performance.getEntriesByType('mark')) {
          result.push({
            name: entry.name,
            // Make everything unix time
            startTime: Math.round(timeOrigin + entry.startTime),
            detail: entry.detail,
            entryType: entry.entryType,
          })
        }
        return result
      },
    }
    return _helpers
  } else {
    // This would be browsers that do not support the performance API.
    // TODO: Implement a polyfill
    console.error('No performance API found globally. Going to be a bad time.')
    return {
      mark () {/*no op*/},
      markOnce () {/*no op*/},
      getMarks() { return [] }
    }
  }
}

const env = detectEnvironment()
export const mark = env.mark
export const getMarks = env.getMarks
export const markOnce = env.markOnce
