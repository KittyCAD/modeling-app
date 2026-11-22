import variant from '@jitl/quickjs-singlefile-cjs-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten-core'
import type { PluginSource } from '@src/lib/communityPlugins/source'
import { isErr } from '@src/lib/trap'
import {
  readPluginSetting,
  type ReadPluginSetting,
} from '@src/lib/communityPlugins/settings/schema'

/** JSON messages are inspected by host adapters before any application contribution is installed. */
export interface GuestContribution {
  kind: string
  definition: unknown
}

export interface PluginRuntime {
  contributions: readonly GuestContribution[]
  invoke: (callback: number) => Error | undefined
  dispose: () => void
}

const bootstrap = `
((publish, notify, readSetting) => {
  const callbacks = [];
  let activating = true;
  const zds = Object.freeze({
    contribute(kind, value) {
      if (!activating) throw new Error('Contribute only during activation');
      const definition = JSON.stringify(value, (_key, item) => {
        if (typeof item !== 'function') return item;
        if (callbacks.length >= 128) throw new Error('Callback limit exceeded');
        return { callback: callbacks.push(item) - 1 };
      });
      const error = publish(JSON.stringify({ kind, definition: JSON.parse(definition) }));
      if (error) throw new Error(error);
    },
    settings: Object.freeze(Object.fromEntries(['string', 'boolean', 'number'].map(type => [
      'get' + type[0].toUpperCase() + type.slice(1),
      key => {
        const result = JSON.parse(readSetting(key));
        if (result.error) throw new Error(result.error);
        if (typeof result.value !== type) throw new Error('Setting has a different type: ' + key);
        return result.value;
      }
    ]))),
    ui: Object.freeze({ notify(message) {
      const error = notify(message);
      if (error) throw new Error(error);
    } }),
  });
  const exports = {};
  const module = { exports };
  return {
    activate(code) {
      const entry = new Function('exports', 'module', code);
      entry(exports, module);
      if (typeof module.exports.default !== 'function') throw new Error('Export a default activation function');
      const result = module.exports.default(zds);
      activating = false;
      if (result && typeof result.then === 'function') throw new Error('Async activation is not supported yet');
    },
    invoke(index) {
      const result = callbacks[index]();
      if (result && typeof result.then === 'function') throw new Error('Async commands are not supported yet');
    }
  };
})
`

/** Each generation owns a separate Wasm module, bounded heap, and guest handles. No browser or Node globals are injected. */
export async function createPluginRuntime(
  source: PluginSource,
  grants: ReadonlySet<string>,
  notify: (message: string) => void,
  readSetting: ReadPluginSetting = (key, contributions) =>
    readPluginSetting(contributions, key)
): Promise<PluginRuntime | Error> {
  let vm: QuickJSContext | undefined
  let bridge: QuickJSHandle | undefined
  let active = false
  let disposed = false
  let deadline = 0
  let notifications = 0
  const contributions: GuestContribution[] = []
  const dispose = () => {
    if (disposed) return
    disposed = true
    active = false
    bridge?.dispose()
    vm?.dispose()
  }
  try {
    const module = await newQuickJSWASMModuleFromVariant(variant)
    vm = module.newContext()
    const context = vm
    context.runtime.setMemoryLimit(8 * 1024 * 1024)
    context.runtime.setMaxStackSize(256 * 1024)
    context.runtime.setInterruptHandler(() => disposed || Date.now() > deadline)
    const readResult = (result: ReturnType<QuickJSContext['evalCode']>) => {
      if (result.error) {
        const message = context.getProp(result.error, 'message')
        const error = new Error(
          context.typeof(message) === 'string'
            ? context.getString(message)
            : 'Plugin execution failed'
        )
        message.dispose()
        result.error.dispose()
        return error
      }
      result.value.dispose()
      return undefined
    }
    const publish = context.newFunction('publish', (message) => {
      if (active || contributions.length >= 32)
        return context.newString('Contribution limit exceeded')
      if (context.typeof(message) !== 'string')
        return context.newString('Expected a contribution message')
      const json = context.getString(message)
      if (json.length > 16_000)
        return context.newString('Contribution is too large')
      let value: unknown
      try {
        value = JSON.parse(json)
      } catch {
        return context.newString('Invalid contribution JSON')
      }
      if (
        !value ||
        typeof value !== 'object' ||
        !('kind' in value) ||
        typeof value.kind !== 'string' ||
        !('definition' in value)
      ) {
        return context.newString('Invalid contribution')
      }
      contributions.push({ kind: value.kind, definition: value.definition })
    })
    const notifyFunction = context.newFunction('notify', (message) => {
      if (!active || disposed)
        return context.newString(
          'Notifications are available only to active commands'
        )
      if (
        !source.manifest.permissions.includes('ui.notify') ||
        !grants.has('ui.notify')
      )
        return context.newString('Permission denied: ui.notify')
      if (context.typeof(message) !== 'string')
        return context.newString('Expected notification text')
      const text = context.getString(message)
      if (text.length > 1_000)
        return context.newString('Notification exceeds 1000 characters')
      if (++notifications > 10)
        return context.newString('Notification limit exceeded')
      try {
        notify(text)
      } catch {
        return context.newString('Notification failed')
      }
    })
    const getSetting = context.newFunction('readSetting', (key) => {
      if (disposed || context.typeof(key) !== 'string')
        return context.newString(
          JSON.stringify({ error: 'Expected a local setting key.' })
        )
      try {
        const name = context.getString(key)
        if (name.length > 64)
          return context.newString(
            JSON.stringify({ error: 'Expected a local setting key.' })
          )
        const value = readSetting(name, contributions)
        return context.newString(
          JSON.stringify(isErr(value) ? { error: value.message } : { value })
        )
      } catch {
        return context.newString(
          JSON.stringify({ error: 'Cannot read this setting.' })
        )
      }
    })
    deadline = Date.now() + 100
    const makeBridge = context.evalCode(bootstrap)
    if (makeBridge.error) {
      publish.dispose()
      notifyFunction.dispose()
      getSetting.dispose()
      const error = readResult(makeBridge)
      dispose()
      return error ?? new Error('Plugin bootstrap failed')
    }
    const made = context.callFunction(
      makeBridge.value,
      context.undefined,
      publish,
      notifyFunction,
      getSetting
    )
    makeBridge.value.dispose()
    publish.dispose()
    notifyFunction.dispose()
    getSetting.dispose()
    if (made.error) {
      const error = readResult(made)
      dispose()
      return error ?? new Error('Plugin bridge failed')
    }
    bridge = made.value
    const activate = context.getProp(bridge, 'activate')
    const code = context.newString(source.javascript)
    const error = readResult(context.callFunction(activate, bridge, code))
    activate.dispose()
    code.dispose()
    if (error) {
      dispose()
      return error
    }
    active = true
    return {
      contributions,
      invoke: (callback) => {
        if (disposed) return new Error('Plugin instance has stopped')
        if (!Number.isInteger(callback) || callback < 0 || callback >= 128)
          return new Error('Unknown plugin callback')
        notifications = 0
        deadline = Date.now() + 100
        const fn = context.getProp(bridge!, 'invoke')
        const argument = context.newNumber(callback)
        const result = readResult(context.callFunction(fn, bridge!, argument))
        argument.dispose()
        fn.dispose()
        return result
      },
      dispose,
    }
  } catch (cause) {
    dispose()
    return new Error(
      `Plugin runtime failed: ${isErr(cause) ? cause.message : String(cause)}`
    )
  }
}
