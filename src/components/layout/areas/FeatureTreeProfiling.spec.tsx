import { signal } from '@preact/signals-core'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { FeatureTreePaneContents } from '@src/components/layout/areas/FeatureTreePane'
import { defaultNodePath, type OperationsByModule } from '@src/lang/wasm'
import { isArray } from '@src/lib/utils'
import { act, fireEvent, screen } from '@testing-library/react'
import { Profiler } from 'react'
import type * as ReactDOMClient from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const { createRoot } = await vi.hoisted(async () => {
  // Happy DOM omits this API. Enable React's browser performance tracking
  // before loading the profiling renderer.
  vi.stubGlobal('console', { ...console, timeStamp: () => {} })
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  return require('react-dom/profiling') as typeof ReactDOMClient
})

const services = vi.hoisted(() => ({
  useApp: vi.fn(),
  useSingletons: vi.fn(),
  modeling: {
    send: () => {},
    state: { matches: (state: string) => state === 'Sketch' },
    actor: { getSnapshot: () => ({ context: { store: {} } }) },
  },
}))

vi.mock('@src/lib/boot', () => ({
  useApp: services.useApp,
  useSingletons: services.useSingletons,
}))
vi.mock('@src/hooks/useModelingContext', () => ({
  useModelingContext: () => services.modeling,
}))

let reactRoot: ReactDOMClient.Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => reactRoot?.unmount())
  container?.remove()
  vi.restoreAllMocks()
})
afterAll(() => vi.unstubAllGlobals())

function variable(moduleId: number, index: number): Operation {
  return {
    type: 'VariableDeclaration',
    name: `parameter${index}`,
    value: { type: 'Number', value: index, ty: { type: 'Unknown' } },
    visibility: 'default',
    nodePath: defaultNodePath(),
    sourceRange: [index * 10, index * 10 + 9, moduleId],
  }
}

describe('feature tree React performance tracking', () => {
  it('keeps row measurements bounded as operations arrive in collapsed modules', async () => {
    const root: Operation[] = Array.from({ length: 100 }, (_, index) => ({
      type: 'ModuleInstance',
      name: `module${index + 1}`,
      moduleId: index + 1,
      nodePath: defaultNodePath(),
      sourceRange: [index * 10, index * 10 + 9, 0],
    }))
    const operations = signal<OperationsByModule>({ map: { 0: root } })
    const latestOperation = signal<string | undefined>(undefined)
    const kclManager = {
      get operationsByModule() {
        return operations.value
      },
      get liveLatestOperationKey() {
        return latestOperation.value
      },
      errors: [],
      hasParseErrors: () => false,
      hasEditsSinceLastExecutionSignal: signal(false),
      diagnosticsSignal: signal([]),
      codeSignal: signal(''),
      astSignal: signal({ body: [] }),
      code: '',
      isExecuting: true,
      operationExecutionGeneration: 1,
      path: '/synthetic/main.kcl',
      editorState: { selection: { ranges: [] } },
      wasmInstancePromise: Object.assign(Promise.resolve({}), {
        status: 'fulfilled',
        value: {},
      }),
      engineCommandManager: {},
      rustContext: {},
    }
    services.useSingletons.mockReturnValue({ kclManager })
    services.useApp.mockReturnValue({
      layout: { signal: signal({}) },
      commands: { actor: {} },
      settings: { useSettings: () => ({}) },
      registry: {
        optional: () => undefined,
        signal: () => ({ value: undefined }),
      },
    })

    const measurements: { name: string; propertyCount: number }[] = []
    // React serializes changed props into these details, which the browser
    // clones for every measured row. Do not retain the details in this test.
    vi.spyOn(performance, 'measure').mockImplementation((name, options) => {
      const properties =
        typeof options === 'object'
          ? options.detail?.devtools?.properties
          : undefined
      if (isArray(properties)) {
        measurements.push({ name, propertyCount: properties.length })
      }
      return {} as PerformanceMeasure
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    reactRoot = createRoot(container)
    await act(async () => {
      reactRoot?.render(
        <MemoryRouter>
          <Profiler id="feature-tree" onRender={() => {}}>
            <FeatureTreePaneContents />
          </Profiler>
        </MemoryRouter>
      )
    })
    expect(
      screen.getAllByRole('button', { name: /^Expand module/ })
    ).toHaveLength(100)

    await act(async () => {
      latestOperation.value = 'latest operation'
      operations.value = {
        map: Object.fromEntries([
          [0, root],
          ...root.map((_, index) => [
            index + 1,
            Array.from({ length: 100 }, (_, operationIndex) =>
              variable(index + 1, operationIndex)
            ),
          ]),
        ]),
      }
    })

    const rows = measurements.filter(({ name }) =>
      /Operation(TreeNode)?Item$/.test(name)
    )
    expect(rows.length).toBeGreaterThan(0)
    // A closed import must not copy the thousands of operations in other
    // modules into each visible row's performance measurement.
    expect(
      Math.max(...rows.map(({ propertyCount }) => propertyCount))
    ).toBeLessThan(100)
    expect(screen.queryByText('parameter0')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand module1' }))
    fireEvent.click(screen.getByRole('button', { name: '100 Parameters' }))
    expect(screen.getByText('parameter0')).toBeVisible()
  })
})
