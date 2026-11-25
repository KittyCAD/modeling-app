import '@src/lib/projectSession/next/testFeature'
import { Registry, provide } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import executorsExtension from '@src/lib/executors/registry'
import { executorsService } from '@src/lib/executors/registry/contract'
import drawingsExtension from '@src/lib/drawings/registry/plugin'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { requireSuccess } from '@src/lib/editors/testViews'
import { beforeAll, expect, it, vi } from 'vitest'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { loadWasm } from '@src/unitTestUtils'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { evaluateDrawings } from '@src/lib/drawings/evaluate'

let wasm: ModuleType
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  wasm = await loadWasm()
})

it('evaluates current native sheets and working imports without an engine connection', async () => {
  const contents = `@settings(kclVersion = "4.0-preview", defaultLengthUnit = in)
import side from "parameters.kcl"
standard = drawing::standardSheet(size = drawing::SheetSize::IsoA4, orientation = drawing::SheetOrientation::Portrait)
custom = drawing::customSheet(width = side, height = 3in, orientation = drawing::SheetOrientation::Landscape, name = "Detail")`
  const memory = await evaluateDrawings(
    {
      src: '/main.kcl',
      files: new Map([
        ['/main.kcl', new TextEncoder().encode(contents)],
        [
          '/parameters.kcl',
          new TextEncoder().encode(
            '@settings(kclVersion = "4.0-preview")\nexport side = 2in'
          ),
        ],
      ]),
    },
    wasm,
    new AbortController().signal
  )
  if (memory instanceof Error) throw memory
  expect(memory.standard).toMatchObject({
    type: 'Sheet',
    value: {
      name: 'ISO A4',
      orientation: 'Portrait',
      width: { n: 210 },
      height: { n: 297 },
    },
  })
  expect(memory.custom).toMatchObject({
    type: 'Sheet',
    value: {
      name: 'Detail',
      orientation: 'Landscape',
      width: { n: 3 },
      height: { n: 2 },
    },
  })
})

it('runs the Drawings mode through the composed executor without starting Modeling', async () => {
  const registry = new Registry()
  try {
    await registry.configure([
      editorsExtension,
      executorsExtension,
      drawingsExtension,
      provide(fileOperationsService, testFileOperations),
      provideWasmPromise(() => Promise.resolve(wasm)),
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor(
        '/main.kcl',
        `@settings(kclVersion = "4.0-preview")
sheet = drawing::standardSheet(size = drawing::SheetSize::AnsiA, orientation = drawing::SheetOrientation::Landscape)`
      )
    )
    const view = requireSuccess(editors.createView(editor, 'drawings.sheet'))
    expect(editors.viewState(view).peek().binding.type).toBe('ready')
    await vi.waitFor(() => {
      const executor = registry.required(executorsService).executors.peek()[0]
      expect(executor?.output.peek().data['drawings.execute']).toEqual({
        sheets: [
          {
            name: 'sheet',
            size: 'ANSI A',
            width: expect.closeTo(279.4),
            height: expect.closeTo(215.9),
          },
        ],
      })
    })
  } finally {
    await registry.dispose()
  }
})

it('reports the required KCL version for drawing declarations', async () => {
  const contents = `@settings(kclVersion = 3.0)
sheet = drawing::standardSheet(size = drawing::SheetSize::IsoA4, orientation = drawing::SheetOrientation::Portrait)`
  const result = await evaluateDrawings(
    {
      src: '/main.kcl',
      files: new Map([['/main.kcl', new TextEncoder().encode(contents)]]),
    },
    wasm,
    new AbortController().signal
  )
  expect(result).toBeInstanceOf(Error)
  if (!(result instanceof Error))
    throw new Error('Expected an unsupported-version error')
  expect(result.message).toContain('added in KCL 4.0')
  expect(result.message).toContain('this program uses KCL 3.0')
})
