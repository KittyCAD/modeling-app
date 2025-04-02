import { isDesktop } from '@src/lib/isDesktop'

function isWeb(): boolean {
  // Identify browser environment when following property is not present
  // https://nodejs.org/dist/latest-v16.x/docs/api/perf_hooks.html#performancenodetiming
  return (
    typeof performance === 'object' &&
    typeof performance.mark === 'function' &&
    // @ts-ignore
    !performance.nodeTiming
  )
}

function isNode(): boolean {
  // @ts-ignore
  return typeof process === 'object' && performance.nodeTiming
}

function getRuntime(): string {
  if (isDesktop()) {
    return 'electron'
  } else if (isNode()) {
    return 'nodejs'
  } else if (isWeb()) {
    return 'web'
  }
  return 'runtime unknown, could not detect'
}

export interface PerformanceMarkDetail {
  [key: string]: any
}

export interface PerformanceMark {
  name: string
  startTime: number
  entryType: string
  detail: null | PerformanceMarkDetail
  duration?: number
}

export interface MarkHelpers {
  mark(name: string, options?: PerformanceMark): void
  markOnce(name: string, options?: PerformanceMark): void
  getMarks(): PerformanceMark[]
}

/**
 * Detect performance API environment, either Web or Node.js
 */
function detectEnvironment(): MarkHelpers {
  const seenMarks: { [key: string]: boolean } = {}
  if (isWeb() || isNode() || isDesktop()) {
    // in a browser context, reuse performance-util
    // https://developer.mozilla.org/en-US/docs/Web/API/Performance

    function _mark(name: string, options?: PerformanceMark) {
      const _options = {
        ...options,
      }

      // Automatically append detail data for a canonical form
      if (!_options.detail) {
        _options.detail = {}
      }
      _options.detail.runtime = getRuntime()

      performance.mark(name, _options)
    }

    const _helpers: MarkHelpers = {
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
        const result: PerformanceMark[] = [
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
            // @ts-ignore - we can assume this is just any object with [key:string]: any
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
      mark() {
        /*no op*/
      },
      markOnce() {
        /*no op*/
      },
      getMarks() {
        return []
      },
    }
  }
}

const env = detectEnvironment()
export const mark = env.mark
export const getMarks = env.getMarks
export const markOnce = env.markOnce
