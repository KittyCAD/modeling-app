import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import fsZds, { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import type { Project } from '@src/lib/project'
import * as trap from '@src/lib/trap'
import { getModule, type ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  type ProjectExplorerRowContextMenuItemContext,
  projectExplorerProjectMenuItemsValueSpec,
  projectExplorerRowContextMenuItemsValueSpec,
} from '@src/registry/contracts/projectExplorer'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import projectExplorerExtension from '@src/registry/extensions/projectExplorer'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const mockWasm = vi.hoisted(() => ({
  import_file_extensions: vi.fn(() => ['step', 'sldprt', 'prt']),
}))
vi.mock('@src/lib/wasm_lib_wrapper', () => ({ getModule: () => mockWasm }))

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})

describe('project explorer extension', () => {
  let registry: Registry
  const send = vi.fn()

  beforeEach(() => {
    registry = new Registry()
    vi.clearAllMocks()
  })
  afterEach(() => {
    registry[Symbol.dispose]()
    vi.restoreAllMocks()
  })

  const context = (
    name = 'cube.step'
  ): ProjectExplorerRowContextMenuItemContext => {
    const projectPath = fsZds.join(fsZds.sep, 'projects', 'assembly')
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    const project: Project = {
      name: 'assembly',
      path: projectPath,
      default_file: mainPath,
      children: [],
      metadata: null,
      kcl_file_count: 1,
      directory_count: 0,
      readWriteAccess: true,
    }
    return {
      project,
      file: { name: 'main.kcl', path: mainPath, children: null },
      readOnly: false,
      row: {
        name,
        path: fsZds.join(projectPath, name),
        isFolder: false,
        isFake: false,
      },
    }
  }

  const configure = (
    promise: Promise<ModuleType> = Promise.resolve(getModule())
  ) => {
    const wasmPromise = signal(promise)
    registry.configure([
      projectExplorerExtension,
      defineRegistryItem({
        provides: [provideWasmPromise(wasmPromise)],
        providesServices: [
          provideService(commandSystemService, {
            send,
            get actor(): never {
              throw new Error('Unexpected command actor access')
            },
            useState(): never {
              throw new Error('Unexpected command hook access')
            },
          }),
        ],
      }),
    ])
    return wasmPromise
  }

  const importItem = () => {
    const item = registry
      .get(projectExplorerRowContextMenuItemsValueSpec)
      .find((item) => item.id === 'import-in-current-file')
    if (!item) throw new Error('Missing import menu contribution')
    return item
  }

  const waitForImport = async () => {
    await vi.waitFor(() =>
      expect(importItem().isVisible?.(context())).toBe(true)
    )
  }

  it('contributes the import and reveal menu items in order', () => {
    registry.configure([projectExplorerExtension])
    expect(
      registry
        .get(projectExplorerProjectMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual(['reveal-in-file-explorer.project-menu'])
    expect(
      registry
        .get(projectExplorerRowContextMenuItemsValueSpec)
        .map((item) => item.id)
    ).toEqual([
      'import-in-current-file',
      'reveal-in-file-explorer.row-context-menu',
    ])
  })

  it.each([
    { name: 'cube.step', canImport: true },
    { name: 'cube.STEP', canImport: true },
    { name: 'cube.prt.1', canImport: true },
    { name: 'part.kcl', canImport: true },
    { name: 'main.kcl', canImport: false },
    { name: 'notes.txt', canImport: false },
    { name: 'notes.md', canImport: false },
    { name: 'folder.prt', isFolder: true, canImport: false },
    { name: 'placeholder.kcl', isFake: true, canImport: false },
  ])(
    'shows the import action for $name: $canImport',
    async ({ name, canImport, isFolder = false, isFake = false }) => {
      configure()
      await waitForImport()
      const menuContext = context(name)
      menuContext.row.isFolder = isFolder
      menuContext.row.isFake = isFake
      expect(importItem().isVisible?.(menuContext)).toBe(canImport)
    }
  )

  it.each([{ readOnly: true }, { file: undefined }, { project: undefined }])(
    'does not import without an editable current file: %j',
    async (override) => {
      configure()
      await waitForImport()
      const menuContext = { ...context(), ...override }
      expect(importItem().isVisible?.(menuContext)).toBe(false)
      importItem().onSelect(menuContext)
      expect(send).not.toHaveBeenCalled()
    }
  )

  it('opens the registered Import command with the nested project-relative path', async () => {
    configure()
    await waitForImport()
    importItem().onSelect(context(fsZds.join('parts', 'cube.step')))
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'Find and select command',
      data: {
        name: 'Import',
        groupId: 'code',
        argDefaultValues: { path: 'parts/cube.step' },
      },
    })
  })

  it('updates the menu when the registry Wasm promise resolves', async () => {
    const pending = Promise.withResolvers<ModuleType>()
    configure(pending.promise)
    expect(importItem().isVisible?.(context())).toBe(false)
    pending.resolve(getModule())
    await waitForImport()
  })

  it('ignores a replaced Wasm promise that resolves late', async () => {
    const pending = Promise.withResolvers<ModuleType>()
    const wasmPromise = configure(pending.promise)
    expect(importItem().isVisible?.(context())).toBe(false)
    await Promise.resolve()
    wasmPromise.value = Promise.resolve({
      ...getModule(),
      import_file_extensions: () => ['obj'],
    })
    await vi.waitFor(() =>
      expect(importItem().isVisible?.(context('cube.obj'))).toBe(true)
    )
    pending.resolve(getModule())
    await pending.promise
    expect(importItem().isVisible?.(context())).toBe(false)
    expect(mockWasm.import_file_extensions).not.toHaveBeenCalled()
  })

  it('does not update after the extension is disposed', async () => {
    const pending = Promise.withResolvers<ModuleType>()
    configure(pending.promise)
    importItem()
    await Promise.resolve()
    registry[Symbol.dispose]()
    pending.resolve(getModule())
    await pending.promise
    expect(mockWasm.import_file_extensions).not.toHaveBeenCalled()
  })

  it('reports Wasm initialization failures and keeps imports hidden', async () => {
    const report = vi
      .spyOn(trap, 'reportRejection')
      .mockImplementation(() => {})
    const pending = Promise.withResolvers<ModuleType>()
    configure(pending.promise)
    expect(importItem().isVisible?.(context())).toBe(false)
    await Promise.resolve()
    const error = new Error('Wasm failed to initialize')
    pending.reject(error)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error))
    expect(importItem().isVisible?.(context())).toBe(false)
  })
})
