import { isInterruptedWebKitRequest } from '@e2e/playwright/lib/console-error-whitelist'
import { describe, expect, it } from 'vitest'

// Error shapes captured from macOS WebKit CI navigation traces.
const interruptedGizmoRequest = {
  name: 'Fetch API cannot load http',
  message:
    '/localhost:3000/clientSideSceneAssets/gizmo_cube/gizmo_cube.glb due to access control checks.',
  stack:
    'at load (http://localhost:3000/node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader.js:226:16)\n' +
    'at loadModel (http://localhost:3000/src/components/gizmo/GizmoRenderer.ts:102:16)',
}
const interruptedRequests = [
  interruptedGizmoRequest,
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
      ...interruptedGizmoRequest,
      message: '/localhost:3000/user/projects due to access control checks.',
    },
    {
      ...interruptedGizmoRequest,
      stack: 'at fetch (http://localhost:3000/src/lib/api.ts:1:1)',
    },
    { ...interruptedGizmoRequest, name: 'TypeError' },
    { ...interruptedGizmoRequest, stack: undefined },
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
