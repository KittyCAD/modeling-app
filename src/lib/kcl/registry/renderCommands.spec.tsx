import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import '@src/lib/projectSession/next/testFeature'
import { cleanup, render } from '@testing-library/react'
import { contribute, factory, provide, Registry, service } from 'plankton'
import {
  assert,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import { EditorView } from '@src/lib/editors/EditorView'
import editorsExtension from '@src/lib/editors/registry'
import {
  type Editor,
  editorsService,
  editorViewsFacet,
} from '@src/lib/editors/registry/contract'
import { codeSurface, requireSuccess } from '@src/lib/editors/testViews'
import { defineEditorView } from '@src/lib/editors/views'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  KCL_RENDER_COMMAND,
  KCL_RENDER_SCOPE,
  renderCommands,
} from '@src/lib/kcl/registry/renderCommands'
import { saveExtension } from '@src/lib/save/registry'
import { editorOnSaveFacet } from '@src/lib/save/registry/contract'
import { fileOperationsService } from '@src/registry/contracts/fileOperations'
import {
  KEYMAP_SCHEMA_VERSION,
  keymapService,
  matchKeymapKeystrokes,
} from '@src/registry/contracts/keymap'
import { commandsExtension } from '@src/registry/extensions/commands'
import keymapExtension from '@src/registry/extensions/keymap'

const persistence = vi.hoisted(() => ({
  readUserKeymapFile: vi.fn(),
  writeUserKeymapFile: vi.fn(),
}))
vi.mock('@src/registry/extensions/keymap/persistence', () => persistence)

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
beforeEach(() => {
  persistence.readUserKeymapFile.mockResolvedValue({
    version: KEYMAP_SCHEMA_VERSION,
    bindings: [],
  })
  persistence.writeUserKeymapFile.mockResolvedValue(undefined)
})
afterEach(cleanup)

async function setup(mode: 'Code' | 'Modeling') {
  const renderTarget = service<{
    attach: (editor: Editor, render: () => Promise<void>) => () => void
  }>('test.render-target')
  const registry = new Registry()
  const saved = vi.fn(async () => undefined)
  await registry.configure([
    provideWasmPromise(() => new Promise<ModuleType>(() => {})),
    editorsExtension,
    saveExtension,
    commandsExtension,
    keymapExtension,
    provide(fileOperationsService, testFileOperations),
    contribute(editorOnSaveFacet, () => ({
      id: 'test.save',
      matches: '*' as const,
      onSave: saved,
    })),
    contribute(editorViewsFacet, () =>
      defineEditorView({
        id: 'test.modeling',
        label: 'Modeling',
        matches: '*' as const,
        Component: () => <div>Scene</div>,
      })
    ),
    factory({
      dependencies: { render: renderCommands },
      create: ({ render }) => ({ items: [provide(renderTarget, render)] }),
    }),
  ])
  onTestFinished(() => registry.dispose())
  const editors = registry.required(editorsService)
  const editor = requireSuccess(editors.openEditor('/main.kcl', 'original'))
  const view = requireSuccess(
    editors.createView(
      editor,
      mode === 'Code' ? 'editors.code' : 'test.modeling'
    )
  )
  const renderModel = vi.fn(async () => {})
  onTestFinished(registry.required(renderTarget).attach(editor, renderModel))
  render(<EditorView instance={view} editors={editors} />)
  const target =
    mode === 'Code'
      ? codeSurface(editors, editor).contentDOM
      : view.element.peek()!
  target.focus()
  return {
    target,
    renderModel,
    saved,
    keymap: registry.required(keymapService),
  }
}

function press(target: HTMLElement, key: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: !/Mac/.test(navigator.platform),
    metaKey: /Mac/.test(navigator.platform),
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

it.each(['Code', 'Modeling'] as const)(
  'renders with Mod+Enter and saves with Mod+S from the focused %s view',
  async (mode) => {
    const { target, renderModel, saved } = await setup(mode)
    expect(press(target, 'Enter').defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(renderModel).toHaveBeenCalledOnce())
    expect(saved).not.toHaveBeenCalled()
    press(target, 's')
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce())
    expect(renderModel).toHaveBeenCalledOnce()
  }
)

it('uses the remapped Render shortcut and stops rendering after it is unbound', async () => {
  const { target, renderModel, keymap } = await setup('Modeling')
  await keymap.addUserBinding({
    command: KCL_RENDER_COMMAND,
    keystrokes: ['mod+shift+enter'],
    when: [KCL_RENDER_SCOPE],
  })
  press(target, 'Enter')
  expect(renderModel).not.toHaveBeenCalled()
  press(target, 'Enter', true)
  await vi.waitFor(() => expect(renderModel).toHaveBeenCalledOnce())
  const remapped = matchKeymapKeystrokes(
    keymap.keymap.value,
    [KCL_RENDER_SCOPE],
    ['mod+shift+enter']
  )
  assert(remapped.type === 'full')
  await keymap.unbind(remapped.item)
  press(target, 'Enter', true)
  expect(renderModel).toHaveBeenCalledOnce()
})
