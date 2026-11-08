import { presentation, codeSurface } from '@src/lib/editors/testViews'
import '@src/lib/projectSession/next/testFeature'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { EditorView } from '@src/lib/editors/EditorView'
import savingExtension from '@src/lib/save/registry'
import { editorSaveService } from '@src/lib/save/registry/contract'
import { testFileOperations } from '@src/lib/fileSystem/testRuntime'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import pngExtension from '@src/lib/png/registry'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
const createUrl = vi.fn<(blob: Blob) => string>()
const revokeUrl = vi.fn()
const writeFile = vi.fn(async () => undefined)
let registry: Registry
let readFile: ReturnType<typeof vi.fn<(src: string) => Promise<Uint8Array>>>
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(() => {
  writeFile.mockClear()
  createUrl
    .mockReset()
    .mockImplementation(() => `blob:png-${createUrl.mock.calls.length}`)
  revokeUrl.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeUrl,
  })
  readFile = vi
    .fn()
    .mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff]))
  registry = new Registry()
  registry.configure([
    editorsExtension,
    savingExtension,
    pngExtension,
    defineRegistryItem({
      providesServices: [
        provideService(fileOperationsService, {
          ...testFileOperations,
          readFile,
          writeFile,
        }),
      ],
    }),
  ])
})
afterEach(() => {
  cleanup()
  registry[Symbol.dispose]()
  if (originalCreate)
    Object.defineProperty(URL, 'createObjectURL', originalCreate)
  else Reflect.deleteProperty(URL, 'createObjectURL')
  if (originalRevoke)
    Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
  else Reflect.deleteProperty(URL, 'revokeObjectURL')
})

function openImage() {
  const editors = registry.get(editorsService)
  const editor = editors.openEditor(
    '/sample.PNG',
    'decoded text must not become the image'
  )
  const mounted = render(
    <EditorView instance={presentation(editors, editor)} editors={editors} />
  )
  return { editor, unmount: mounted.unmount }
}

it('renders original binary bytes and releases image URLs on source replacement and unmount', async () => {
  const { editor, unmount } = openImage()
  const image = await screen.findByRole('img', { name: 'sample.PNG' })
  expect(readFile).toHaveBeenCalledWith('/sample.PNG')
  const blob = createUrl.mock.calls[0][0]
  const bytes = await new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
  expect(new Uint8Array(bytes)).toEqual(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff])
  )
  const oldUrl = image.getAttribute('src')
  act(() => registry.get(editorsService).setSource(editor.id, '/renamed.png'))
  await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(2))
  expect(revokeUrl).toHaveBeenCalledWith(oldUrl)
  unmount()
  expect(revokeUrl).toHaveBeenCalledWith(createUrl.mock.results[1].value)
})

it('shows decoding and file-read failures', async () => {
  const { editor } = openImage()
  fireEvent.error(await screen.findByRole('img', { name: 'sample.PNG' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Unable to display sample.PNG as a PNG image.'
  )
  readFile.mockRejectedValueOnce(new Error('Permission denied'))
  act(() =>
    registry.get(editorsService).setSource(editor.id, '/unreadable.png')
  )
  expect(await screen.findByText('Permission denied')).toBeVisible()
})

it('prevents a binary backing buffer from being saved as decoded text', async () => {
  const { editor } = openImage()
  expect(codeSurface(registry.get(editorsService), editor).state.readOnly).toBe(
    true
  )
  const result = await registry.get(editorSaveService).save(editor)
  expect(result).toBeInstanceOf(Error)
  expect(result?.message).toBe('PNG images are read-only.')
  expect(writeFile).not.toHaveBeenCalled()
})

it('ignores an older read after the source changes', async () => {
  const pending = Promise.withResolvers<Uint8Array>()
  readFile.mockReturnValueOnce(pending.promise)
  const { editor } = openImage()
  act(() => registry.get(editorsService).setSource(editor.id, '/new.png'))
  expect(await screen.findByRole('img', { name: 'new.png' })).toBeVisible()
  await act(async () => {
    pending.resolve(new Uint8Array([1, 2, 3]))
  })
  expect(createUrl).toHaveBeenCalledOnce()
  expect(
    screen.queryByRole('img', { name: 'sample.PNG' })
  ).not.toBeInTheDocument()
})
