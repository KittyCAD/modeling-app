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

        // Always overwrite these values
        if (_options.detail) {
          _options.detail.runtime = getRuntime()
        }

        performance.mark(name, options)
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

        // Always overwrite these values
        if (_options.detail) {
          _options.detail.runtime = getRuntime()
        }

        performance.mark(name, options)
        seenMarks[name] = true
      },
      getMarks() {
        let timeOrigin = performance.timeOrigin
        const result = [
          {
            name: 'code/timeOrigin',
            startTime: Math.round(timeOrigin),
            detail: { runtime: getRuntime() },
          },
        ]
        for (const entry of performance.getEntriesByType('mark')) {
          result.push({
            name: entry.name,
            // Make everything unix time
            startTime: Math.round(timeOrigin + entry.startTime),
            detail: entry.detail,
            duration: entry.duration,
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
