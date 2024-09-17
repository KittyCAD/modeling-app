// Get the longest width of values or column name
function columnWidth(arr, key) {
  // Default as the column name
  let maxLength = key.length

  // for each value of that key, check if the length is longer
  arr.forEach((value) => {
    const valueAsString = String(value[key])
    maxLength =
      valueAsString.length > maxLength ? valueAsString.length : maxLength
  })
  return maxLength
}

function printHeader(columnWidths) {
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

function printDivider(columnWidths) {
  const headers = ['|']
  const padLeft = ' '
  Object.keys(columnWidths).forEach((key) => {
    const keyMaxLength = columnWidths[key]
    const dashedLines = '-'.repeat(keyMaxLength)
    headers.push(padLeft, dashedLines, ' ', '|')
  })
  return headers.join('')
}

function printRow(row, columnWidths) {
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

export function printMarkDownTable(arr) {
  if (arr.length === 0) {
    return
  }
  const sample = arr[0]
  const columnWidths = {}
  Object.keys(sample).forEach((key) => {
    const width = columnWidth(arr, key)
    columnWidths[key] = width
  })

  const lines = []
  lines.push(printHeader(columnWidths))
  lines.push(printDivider(columnWidths))
  arr.forEach((row) => {
    lines.push(printRow(row, columnWidths))
  })
  return lines
}

function computeDeltaTotal(arr) {
  let startTime = -1
  let total = 0
  const deltaTotalArray = arr.map((row) => {
    const delta =
      startTime === -1 ? 0 : Number(row.startTime) - Number(startTime)
    startTime = row.startTime
    total += delta
    return {
      name: row.name,
      startTime: row.startTime,
      delta: delta.toFixed(2),
      total: total.toFixed(2),
    }
  })
  return deltaTotalArray
}

export function printDeltaTotal(arr) {
  const deltaTotalArray = computeDeltaTotal(arr)
  return printMarkDownTable(deltaTotalArray)
}

function printRawRow(row) {
  const _row = ['']
  Object.keys(row).forEach((key) => {
    const value = String(row[key])
    _row.push(value, ' ')
  })
  return _row.join('')
}

export function printRawMarks(arr) {
  const headers = ['Name', 'Timestamp', 'Delta', 'Total', 'Detail']
  const lines = ['```', headers.join(' ')]
  const deltaTotalArray = computeDeltaTotal(arr)
  deltaTotalArray.forEach((row) => {
    lines.push(printRawRow(row))
  })
  lines.push('```')
  return lines
}

export function printInvocationCount(arr) {
  const counts = {}
  arr.forEach((mark) => {
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

function isWeb() {
  // Identify browser environment when following property is not present
  // https://nodejs.org/dist/latest-v16.x/docs/api/perf_hooks.html#performancenodetiming
  return (
    typeof performance === 'object' &&
    typeof performance.mark === 'function' &&
    !performance.nodeTiming
  )
}

function isNode() {
  return typeof process === 'object' && performance.nodeTiming
}

function getRuntime() {
  if (isNode()) {
    return 'nodejs'
  } else if (isWeb()) {
    return 'web'
  }

  return 'BIG NO.'
}

/**
 * Detect performance API environment, either Web or Node.js
 */
function detectEnvironment() {
  const seenMarks = {}
  // TODO KEVIN: Support different browsers, create a polyfill for environments that do not support performance API
  if (isWeb() || isNode()) {
    // in a browser context, reuse performance-util
    // https://developer.mozilla.org/en-US/docs/Web/API/Performance
    return {
      mark(name: string, options?: MarkOptions) {
        const _options = {
          ...options,
        }

        if (!_options.detail) {
          _options.detail = {}
        }
        _options.detail.runtime = getRuntime()

        performance.mark(name, _options)
      },
      markOnce(name: string, options?: MarkOptions) {
        // TODO KEVIN: call mark? instead of rewriting this...
        if (seenMarks[name]) {
          console.log('mark has been seen! no thank you!')
          return
        }

        const _options = {
          ...options,
        }

        if (!_options.detail) {
          _options.detail = {}
        }
        _options.detail.runtime = getRuntime()

        performance.mark(name, _options)
        seenMarks[name] = true
      },
      getMarks() {
        let timeOrigin = performance.timeOrigin
        const result = [
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
  } else {
    console.error('No performance API found globally. Going to be a bad time.')
  }
  // TODO auto add base detail for {runtime:'web' | 'nodejs' | etc..}
  // Do this for mark and measure
  // Helper function to measure against code/timeOrigin
}

const env = detectEnvironment()
export const mark = env?.mark
export const getMarks = env?.getMarks
export const markOnce = env?.markOnce
