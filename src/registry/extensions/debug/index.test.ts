import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { EngineDebugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'
import { afterEach, expect, it, vi } from 'vitest'
import debug from '.'

const registries: Registry[] = []
afterEach(() => {
  for (const registry of registries.splice(0)) registry[Symbol.dispose]()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.querySelector('[data-testid="stream"]')?.remove()
})

function createRegistry() {
  const sendSceneCommand = vi.fn().mockResolvedValue(undefined)
  const manager = { sendSceneCommand } as unknown as ConnectionManager
  const context = {} as RustContext
  const registry = new Registry()
  registries.push(registry)
  registry.configure([
    debug,
    defineRegistryItem({
      providesServices: [
        provideService(engineConnectionService, { manager }),
        provideService(rustContextService, { context }),
      ],
    }),
  ])
  registry.inspect()
  return { registry, manager, context, sendSceneCommand }
}

it('exposes runtime services and console helpers without an app or editor', () => {
  const { manager, context, sendSceneCommand } = createRegistry()
  expect(window.engineCommandManager).toBe(manager)
  expect(window.rustContext).toBe(context)
  expect(window.engineDebugger).toBe(EngineDebugger)
  window.enableFillet?.()
  expect(window._enableFillet).toBe(true)
  window._enableFillet = false
  expect(window._enableFillet).toBe(false)
  window.zoomToFit?.()
  expect(sendSceneCommand).toHaveBeenCalledExactlyOnceWith({
    type: 'modeling_cmd_req',
    cmd_id: expect.any(String),
    cmd: { type: 'zoom_to_fit', object_ids: [], padding: 0.2, animated: false },
  })
})

it('enables mouse logging once and removes its listener on stop and disposal', () => {
  const { registry } = createRegistry()
  const stream = document.createElement('div')
  stream.dataset.testid = 'stream'
  document.body.append(stream)
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
  vi.spyOn(stream, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 50, 400, 200)
  )
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const click = () =>
    document.dispatchEvent(
      new MouseEvent('click', { clientX: 200, clientY: 100 })
    )
  const enable = window.enableMousePositionLogs
  const stop = enable?.()
  window.enableMousePositionLogs?.()
  click()
  expect(log).toHaveBeenCalledTimes(2)
  expect(log).toHaveBeenCalledWith(
    "[mouse→e2e] makeMouseHelpers(0.2500, 0.2500, { format: 'ratio' })"
  )
  expect(log).toHaveBeenCalledWith(
    "[mouse→e2e] makeMouseHelpers(250, 200, { steps: 20, format: 'pixels' })"
  )
  stop?.()
  click()
  expect(log).toHaveBeenCalledTimes(2)
  window.enableMousePositionLogs?.()
  registry[Symbol.dispose]()
  enable?.()
  click()
  expect(log).toHaveBeenCalledTimes(2)
})

it('does not restore globals from an older registry that was already disposed', () => {
  const previous = Object.getOwnPropertyDescriptor(
    window,
    'engineCommandManager'
  )
  const first = createRegistry()
  const second = createRegistry()
  expect(window.engineCommandManager).toBe(second.manager)
  first.registry[Symbol.dispose]()
  expect(window.engineCommandManager).toBe(second.manager)
  second.registry[Symbol.dispose]()
  expect(
    Object.getOwnPropertyDescriptor(window, 'engineCommandManager')
  ).toEqual(previous)
})

it('restores a still-live registry when the newer registry is disposed', () => {
  const first = createRegistry()
  const second = createRegistry()
  second.registry[Symbol.dispose]()
  expect(window.engineCommandManager).toBe(first.manager)
})

it('leaves console replacements alone during disposal', () => {
  const previous = Object.getOwnPropertyDescriptor(window, 'zoomToFit')
  const { registry } = createRegistry()
  const replacement = vi.fn()
  Object.defineProperty(window, 'zoomToFit', {
    configurable: true,
    value: replacement,
  })
  registry[Symbol.dispose]()
  expect(window.zoomToFit).toBe(replacement)
  if (previous) Object.defineProperty(window, 'zoomToFit', previous)
  else Reflect.deleteProperty(window, 'zoomToFit')
})

it('can be constructed without a browser window', () => {
  vi.stubGlobal('window', undefined)
  const registry = new Registry()
  registries.push(registry)
  registry.configure([debug])
  expect(() => registry.inspect()).not.toThrow()
})
