import { setImmediate } from 'node:timers/promises'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { getModule } from '@src/lib/wasm_lib_wrapper'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  createEmptyPersistedKeymap,
  keymapService,
} from '@src/registry/contracts/keymap'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import keymap from '@src/registry/extensions/keymap'
import projectExplorer from '@src/registry/extensions/projectExplorer'
import { factory, provide, Registry } from 'plankton'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  imports: vi.fn(),
}))
vi.mock('@src/registry/extensions/keymap/persistence', () => ({
  readUserKeymapFile: mocks.read,
  writeUserKeymapFile: mocks.write,
}))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({
  getModule: () => ({ import_file_extensions: mocks.imports }),
}))

let registry: Registry
beforeEach(() => {
  registry = new Registry()
  mocks.read.mockReset().mockResolvedValue(createEmptyPersistedKeymap())
  mocks.write.mockReset().mockResolvedValue(undefined)
  mocks.imports.mockReset().mockReturnValue(['step'])
})
afterEach(async () => {
  await registry.dispose()
})

const providers = () => [
  provide(fileOperationsService, testFileOperations),
  provideWasmPromise(() => Promise.resolve(getModule())),
]

it('starts persisted keymap loading and explorer observations after retired resources finish cleanup', async () => {
  const cleanup = Promise.withResolvers<undefined>()
  const cleanupStarted = Promise.withResolvers<undefined>()
  const retired = factory({
    create: () => ({
      dispose: () => {
        cleanupStarted.resolve(undefined)
        return cleanup.promise
      },
    }),
  })
  await registry.configure([retired])
  const replacement = registry.configure([keymap, projectExplorer, providers()])
  try {
    await cleanupStarted.promise
    // Let constructor-scheduled microtasks run while retirement is still blocked.
    await setImmediate()
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.imports).not.toHaveBeenCalled()
  } finally {
    cleanup.resolve(undefined)
    await replacement
  }
  expect(mocks.read).toHaveBeenCalledOnce()
  expect(mocks.imports).toHaveBeenCalledOnce()
})

it('does not read persisted keymaps or start explorer observations after acquisition rolls back', async () => {
  const backing = providers()
  await registry.configure(backing)
  const failure = new Error('later acquisition failed')
  const broken = factory({
    create: () => {
      throw failure
    },
  })
  await expect(
    registry.configure([keymap, projectExplorer, backing, broken])
  ).rejects.toBe(failure)
  await setImmediate()
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.imports).not.toHaveBeenCalled()
})

it('ignores an initial keymap read that resolves after its owner is removed', async () => {
  const initialRead =
    Promise.withResolvers<ReturnType<typeof createEmptyPersistedKeymap>>()
  mocks.read.mockReturnValue(initialRead.promise)
  const backing = providers()
  await registry.configure([keymap, backing])
  const persisted = registry.required(keymapService).persistedKeymap
  await registry.configure(backing)
  initialRead.resolve({
    ...createEmptyPersistedKeymap(),
    bindings: [{ command: 'late', keystrokes: ['mod+k'] }],
  })
  await initialRead.promise
  await Promise.resolve()
  expect(persisted.value).toEqual(createEmptyPersistedKeymap())
})

it('holds saves requested during retirement until startup has loaded the persisted keymap', async () => {
  const cleanup = Promise.withResolvers<undefined>()
  const retired = factory({
    create: () => ({ dispose: () => cleanup.promise }),
  })
  await registry.configure([retired])
  const replacement = registry.configure([keymap, providers()])
  const saving = registry
    .required(keymapService)
    .savePersistedKeymap(createEmptyPersistedKeymap())
  try {
    await setImmediate()
    expect(mocks.write).not.toHaveBeenCalled()
  } finally {
    cleanup.resolve(undefined)
    await replacement
    await saving
  }
  expect(mocks.read).toHaveBeenCalledOnce()
  expect(mocks.write).toHaveBeenCalledOnce()
})

it('rejects queued saves when their keymap owner is removed before the initial read finishes', async () => {
  const initialRead =
    Promise.withResolvers<ReturnType<typeof createEmptyPersistedKeymap>>()
  mocks.read.mockReturnValue(initialRead.promise)
  const backing = providers()
  await registry.configure([keymap, backing])
  const service = registry.required(keymapService)
  const saving = service.savePersistedKeymap(createEmptyPersistedKeymap())
  await registry.configure(backing)
  const rejected = expect(saving).rejects.toThrow('Keymap is disposed')
  initialRead.resolve(createEmptyPersistedKeymap())
  await rejected
  expect(mocks.write).not.toHaveBeenCalled()
})
