import { writeRawTelemetryFile, writeTelemetryFile } from '@src/lib/desktop'
import type { PerformanceMark } from '@src/lib/performance'
import { getMarks } from '@src/lib/performance'

let args: any = null

// Get the longest width of values or column name
export function columnWidth(arr: { [key: string]: any }, key: string): number {
  let maxLength = key.length

  // for each value of that key, check if the length is longer
  arr.forEach((value: any) => {
    const valueAsString = String(value[key])
    maxLength =
      valueAsString.length > maxLength ? valueAsString.length : maxLength
  })
  return maxLength
}

export function printHeader(columnWidths: MaxWidth): string {
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

export function printDivider(columnWidths: MaxWidth): string {
  const headers = ['|']
  const padLeft = ' '
  Object.keys(columnWidths).forEach((key) => {
    const keyMaxLength = columnWidths[key]
    const dashedLines = '-'.repeat(keyMaxLength)
    headers.push(padLeft, dashedLines, ' ', '|')
  })
  return headers.join('')
}

export function printRow(
  row: { [key: string]: any },
  columnWidths: MaxWidth
): string {
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

export interface MaxWidth {
  [key: string]: number
}

export function printMarkDownTable(
  marks: Array<{ [key: string]: any }>
): Array<string> {
  if (marks.length === 0) {
    return []
  }
  const sample = marks[0]
  const columnWidths: MaxWidth = {}
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

export interface PerformanceDeltaTotal {
  name: string
  startTime: number
  delta: string
  total: string
}

export function computeDeltaTotal(
  marks: Array<PerformanceMark>
): Array<PerformanceDeltaTotal> {
  let startTime = -1
  let total = 0
  const deltaTotalArray: Array<PerformanceDeltaTotal> = marks.map(
    (row: PerformanceMark) => {
      const delta =
        startTime === -1 ? 0 : Number(row.startTime) - Number(startTime)
      startTime = row.startTime
      total += delta
      const formatted: PerformanceDeltaTotal = {
        name: row.name,
        startTime: row.startTime,
        delta: delta.toFixed(2),
        total: total.toFixed(2),
      }
      return formatted
    }
  )
  return deltaTotalArray
}

export function printDeltaTotal(marks: Array<PerformanceMark>): string[] {
  const deltaTotalArray = computeDeltaTotal(marks)
  return printMarkDownTable(deltaTotalArray)
}

export function printRawRow(row: { [key: string]: any }): string {
  const _row = ['']
  Object.keys(row).forEach((key) => {
    const value = String(row[key])
    _row.push(value, ' ')
  })
  return _row.join('')
}

export function printRawMarks(marks: Array<PerformanceMark>): string[] {
  const headers = ['Name', 'Timestamp', 'Delta', 'Total', 'Detail']
  const lines = ['```', headers.join(' ')]
  const deltaTotalArray = computeDeltaTotal(marks)
  deltaTotalArray.forEach((row) => {
    lines.push(printRawRow(row))
  })
  lines.push('```')
  return lines
}

export function printInvocationCount(marks: Array<PerformanceMark>): string[] {
  const counts: { [key: string]: number } = {}
  marks.forEach((mark: PerformanceMark) => {
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

export async function maybeWriteToDisk() {
  if (!args) {
    args = await window.electron.getArgvParsed()
  }
  if (args.telemetry) {
    setInterval(() => {
      const marks = getMarks()
      const deltaTotalTable = printDeltaTotal(marks)
      writeTelemetryFile(deltaTotalTable.join('\n'))
        .then(() => {})
        .catch(() => {})
      writeRawTelemetryFile(JSON.stringify(marks))
        .then(() => {})
        .catch(() => {})
    }, 5000)
  }
}
