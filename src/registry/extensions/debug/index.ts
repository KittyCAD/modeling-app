import { defineRegistryItemFactory } from '@kittycad/registry'
import { EngineDebugger, type Debugger } from '@src/lib/debugger'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type RustContext from '@src/lib/rustContext'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import { reportRejection } from '@src/lib/trap'
import { engineStreamZoomToFit } from '@src/lib/utils'
import { engineConnectionService } from '@src/registry/contracts/engineConnection'

declare global {
  interface Window {
    engineCommandManager: ConnectionManager
    rustContext: RustContext
    engineDebugger: Debugger
    /** Log stream click coordinates for SceneFixture.makeMouseHelpers. */
    enableMousePositionLogs?: () => () => void
    enableFillet?: () => void
    zoomToFit?: () => void
    _enableFillet?: boolean
  }
}

/** Each live registry owns its console helpers; the newest registry is exposed. */
const installations = new WeakMap<
  Window,
  {
    original: Map<string, PropertyDescriptor | undefined>
    entries: PropertyDescriptorMap[]
  }
>()

function exposeGlobals(target: Window, properties: PropertyDescriptorMap) {
  let state = installations.get(target)
  if (!state) {
    state = {
      original: new Map(
        Object.keys(properties).map((key) => [
          key,
          Object.getOwnPropertyDescriptor(target, key),
        ])
      ),
      entries: [],
    }
    installations.set(target, state)
  }
  const currentState = state
  currentState.entries.push(properties)
  Object.defineProperties(target, properties)
  return () => {
    const index = currentState.entries.indexOf(properties)
    if (index < 0) return
    currentState.entries.splice(index, 1)
    if (index !== currentState.entries.length) return
    const previous = currentState.entries.at(-1)
    for (const [key, installed] of Object.entries(properties)) {
      const current = Object.getOwnPropertyDescriptor(target, key)
      // Leave console overrides or globals installed by other code alone.
      if (
        current?.get !== installed.get ||
        current?.set !== installed.set ||
        current?.value !== installed.value
      )
        continue
      const restore = previous?.[key] ?? currentState.original.get(key)
      if (restore) Object.defineProperty(target, key, restore)
      else Reflect.deleteProperty(target, key)
    }
    if (currentState.entries.length === 0) installations.delete(target)
  }
}

export default defineRegistryItemFactory((ctx) => {
  if (typeof window === 'undefined') return { id: 'debug' }
  const target = window
  const document = target.document
  let disposed = false
  let logging = false
  let filletEnabled = false
  const stopMousePositionLogs = () => {
    document.removeEventListener('click', logMousePosition, true)
    logging = false
  }
  function logMousePosition(event: MouseEvent) {
    const stream = document.querySelector('[data-testid="stream"]')
    const width = document.documentElement.clientWidth
    const height = document.documentElement.clientHeight
    if (!stream || width <= 0 || height <= 0) return
    const bounds = stream.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    console.log(
      `[mouse→e2e] makeMouseHelpers(${x.toFixed(4)}, ${y.toFixed(4)}, { format: 'ratio' })`
    )
    console.log(
      `[mouse→e2e] makeMouseHelpers(${Math.round(x * width)}, ${Math.round(y * height)}, { steps: 20, format: 'pixels' })`
    )
  }

  // Accessors resolve services after registry construction and follow replacements.
  const restoreGlobals = exposeGlobals(target, {
    engineCommandManager: {
      configurable: true,
      get: () => ctx.services.get(engineConnectionService).manager,
    },
    rustContext: {
      configurable: true,
      get: () => ctx.services.get(rustContextService).context,
    },
    engineDebugger: { configurable: true, value: EngineDebugger },
    enableMousePositionLogs: {
      configurable: true,
      value: () => {
        if (disposed) return stopMousePositionLogs
        if (!logging) {
          document.addEventListener('click', logMousePosition, true)
          logging = true
        }
        return stopMousePositionLogs
      },
    },
    enableFillet: {
      configurable: true,
      value: () => {
        if (!disposed) filletEnabled = true
      },
    },
    _enableFillet: {
      configurable: true,
      get: () => filletEnabled,
      set: (value: boolean) => {
        filletEnabled = value
      },
    },
    zoomToFit: {
      configurable: true,
      value: () => {
        if (disposed) return
        engineStreamZoomToFit({
          engineCommandManager: ctx.services.get(engineConnectionService)
            .manager,
          padding: 0.2,
        }).catch(reportRejection)
      },
    },
  })

  return {
    id: 'debug',
    dispose: () => {
      disposed = true
      stopMousePositionLogs()
      restoreGlobals()
    },
  }
}, 'debug')
