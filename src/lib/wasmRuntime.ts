import { notifyActiveWasmInstance } from '@src/lib/wasmLifecycle'

// Only this module sees the native constructor and initialization output.
// Public module objects contain utilities, never context-allocation capabilities.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type NativeModule = typeof import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib')
export type ModuleType = Omit<NativeModule, 'Context' | 'default' | 'initSync'>
type ContextArguments = ConstructorParameters<NativeModule['Context']>
type InitializeInput = Parameters<NativeModule['default']>[0]

const contextFactories = new WeakMap<
  ModuleType,
  (...args: ContextArguments) => InstanceType<NativeModule['Context']>
>()
let currentModule: ModuleType
let initializationGeneration = 0

function checkGeneration(generation: number) {
  if (generation !== initializationGeneration) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new DOMException('Superseded Wasm initialization', 'AbortError')
  }
}

export async function loadWasmModule(
  input?: InitializeInput,
  generation?: number
): Promise<ModuleType> {
  if (generation !== undefined) checkGeneration(generation)
  const native = await import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib')
  if (generation !== undefined) checkGeneration(generation)
  await native.default(input)
  if (generation !== undefined) checkGeneration(generation)
  const { Context, default: initialize, initSync, ...module } = native
  contextFactories.set(module, (...args) => new Context(...args))
  return module
}

export function createNativeContext(
  module: ModuleType,
  ...args: ContextArguments
) {
  const create = contextFactories.get(module)
  if (!create) {
    // eslint-disable-next-line suggest-no-throw/suggest-no-throw
    throw new Error('Wasm context requires an initialized owned module.')
  }
  return create(...args)
}

export function getPublicModule(): ModuleType {
  return currentModule
}

export function activateWasmModule(module: ModuleType) {
  currentModule = module
}

async function publishCurrentModule(
  input: InitializeInput,
  generation: number
) {
  const module = await loadWasmModule(input, generation)
  checkGeneration(generation)
  activateWasmModule(module)
  // Runtime flags must be installed before callers can use the new runtime.
  await notifyActiveWasmInstance(module)
  checkGeneration(generation)
  return module
}

export const wasmUrl = () => {
  const wasmFile = '/kcl_wasm_lib_bg.wasm'
  if (typeof process !== 'undefined' && process.env?.VITE_WASM_BASE_URL) {
    return process.env.VITE_WASM_BASE_URL + wasmFile
  }
  return new URL(
    '../../rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm',
    import.meta.url
  ).href
}

export const startWasmFromBuffer = (buffer: ArrayBuffer): Promise<ModuleType> =>
  publishCurrentModule({ module_or_path: buffer }, ++initializationGeneration)

// Crash recovery is the only production caller allowed to restart a runtime.
export const restartWasmModule = (): Promise<ModuleType> =>
  publishCurrentModule(undefined, ++initializationGeneration)

export const initialiseWasm = async (): Promise<ModuleType> => {
  const generation = ++initializationGeneration
  try {
    const input = await fetch(wasmUrl())
    const buffer = await input.arrayBuffer()
    return publishCurrentModule({ module_or_path: buffer }, generation)
  } catch (error) {
    console.log('Error initialising WASM', error)
    return Promise.reject(error)
  }
}
