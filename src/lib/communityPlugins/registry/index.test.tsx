import '@src/lib/projectSession/next/testFeature'
import { vi, afterEach, beforeAll, describe, expect, it } from 'vitest'
vi.mock('react-hot-toast', () => ({ default: vi.fn(), toast: vi.fn() }))
import toast from 'react-hot-toast'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import executorsExtension from '@src/lib/executors/registry'
import communityPlugins from '@src/lib/communityPlugins/registry'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { commandsFacet } from '@src/registry/contracts/commands'

const hello = `/* @zds-plugin
id = "hello"
name = "Hello"
api_version = 1
permissions = ["ui.notify"]
*/
import type { Activate } from '@zoo/zds-plugin'
const activate: Activate = zds => zds.contribute('command', { id: 'hello', title: 'Say hello', run: () => zds.ui.notify('Hello!') })
export default activate`

describe('Plugin Builder', () => {
  let registry: Registry | undefined
  beforeAll(async () => {
    await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  })
  afterEach(async () => {
    cleanup()
    await registry?.dispose()
    vi.clearAllMocks()
  })
  it('starts only after approval, reloads an edited buffer, and withdraws commands when the document closes', async () => {
    registry = new Registry()
    await registry.configure([
      editorsExtension,
      executorsExtension,
      communityPlugins,
    ])
    const editors = registry.required(editorsService)
    const editor = requireSuccess(
      editors.openEditor('/plugins/hello.zds.ts', hello)
    )
    const instance = requireSuccess(
      editors.createView(editor, 'communityPlugins.builder')
    )
    const binding = editors.viewState(instance).value.binding
    if (binding.type !== 'ready') throw new Error('Expected Plugin Builder')
    const Component = binding.Component
    render(<Component editor={editor} instance={instance} active />)
    const commands = () =>
      registry!
        .get(commandsFacet)
        .filter((command) => command.groupId.startsWith('community.'))
    await screen.findByText('Hello')
    expect(commands()).toHaveLength(0)
    expect(
      screen.getByRole('button', { name: 'Start / approve reload' })
    ).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Start / approve reload' })
    )
    await vi.waitFor(() => expect(commands()).toHaveLength(1))
    commands()[0].onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Hello!')
    const previous = commands()[0]
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: hello.replace('Hello!', 'Edited!'),
      },
    })
    await vi.waitFor(() => expect(commands()[0]).not.toBe(previous))
    commands()[0].onSubmit()
    expect(toast).toHaveBeenLastCalledWith('Edited!')
    const edited = commands()[0]
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: hello + '\nexport default (',
      },
    })
    await screen.findByRole('alert')
    expect(commands()[0]).toBe(edited)
    cleanup()
    editors.closeEditor(editor.id)
    await vi.waitFor(() => expect(commands()).toHaveLength(0))
  })
})
