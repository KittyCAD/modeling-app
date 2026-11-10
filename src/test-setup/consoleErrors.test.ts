import { isInterruptedWebKitRequest } from '@e2e/playwright/lib/console-error-whitelist'
import { describe, expect, it } from 'vitest'

// Error shapes captured from macOS WebKit CI navigation traces.
const interruptedRequests = [
  {
    name: 'Cannot load blob',
    message: 'ttp://localhost:3000/thumbnail due to access control checks.',
    stack: 'at unknown (http://localhost:3000/src/lib/screenshot.ts:120:63)',
  },
  {
    name: 'Cannot load blob',
    message: 'ttp://localhost:3000/file due to access control checks.',
    stack: 'at unknown (http://localhost:3000/src/lib/fs-zds/opfs.ts:171:29)',
  },
  {
    name: 'Cannot load http',
    message:
      '/localhost:3000/src/lib/fs-zds/opfsWorker.ts?worker_file&type=module due to access control checks.',
    stack:
      'at WorkerWrapper (http://localhost:3000/src/lib/fs-zds/opfsWorker.ts?worker&inline:2:20)',
  },
]

describe('WebKit navigation cancellations', () => {
  it.each(interruptedRequests)(
    'recognizes outgoing $name requests',
    (error) => {
      expect(isInterruptedWebKitRequest(error, 'webkit', true)).toBe(true)
      // The same failure on a loaded page must still fail the test.
      expect(isInterruptedWebKitRequest(error, 'webkit', false)).toBe(false)
      expect(isInterruptedWebKitRequest(error, 'Google Chrome', true)).toBe(
        false
      )
    }
  )

  it.each([
    {
      ...interruptedRequests[0],
      stack: 'at unknown (http://localhost:3000/src/other.ts:1:1)',
    },
    { ...interruptedRequests[0], stack: undefined },
    {
      ...interruptedRequests[2],
      message: 'Worker blocked by Content Security Policy',
    },
    { ...interruptedRequests[2], name: 'TypeError' },
    {
      name: '',
      message: 'ResizeObserver loop completed with undelivered notifications.',
      stack: '',
    },
  ])('keeps unrelated errors fatal during navigation', (error) => {
    expect(isInterruptedWebKitRequest(error, 'webkit', true)).toBe(false)
  })
})
