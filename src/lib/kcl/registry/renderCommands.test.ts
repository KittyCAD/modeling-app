import '@src/lib/projectSession/next/testFeature'
import { signal } from '@preact/signals-core'
import { Registry } from 'plankton'
import editorsExtension from '@src/lib/editors/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import { requireSuccess } from '@src/lib/editors/testViews'
import {
  createRenderTargets,
  renderCommands,
  KCL_RENDER_COMMAND,
  KCL_RENDER_SCOPE,
} from '@src/lib/kcl/registry/renderCommands'
import { commandsFacet } from '@src/registry/contracts/commands'
import {
  keymapFacet,
  createKeymapTree,
  resolveKeymapItems,
  matchKeymapKeystrokes,
} from '@src/registry/contracts/keymap'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { beforeAll, expect, it, vi } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
})
it('routes Render to the focused editor, retains the palette target, and withdraws closed utils', async () => {
  const registry = new Registry()
  await registry.configure([editorsExtension])
  const editors = registry.required(editorsService)
  const first = requireSuccess(editors.createEditor('first'))
  const second = requireSuccess(editors.createEditor('second'))
  const views = [first, second].map((editor) => {
    const view = requireSuccess(editors.createView(editor, 'editors.code'))
    const element = document.createElement('div')
    element.tabIndex = -1
    document.body.append(element)
    return { ...view, element: signal(element) }
  })
  const palette = document.createElement('input')
  document.body.append(palette)
  let paletteOpen = false
  const utils = createRenderTargets(
    () => views,
    () => paletteOpen
  )
  const renderFirst = vi.fn(async () => {})
  const renderSecond = vi.fn(async () => {})
  const releaseFirst = utils.attach(first, renderFirst)
  const releaseSecond = utils.attach(second, renderSecond)
  try {
    expect(utils.available.value).toBe(false)
    views[0].element.value.focus()
    expect(utils.available.value).toBe(true)
    await utils.run()
    expect(renderFirst).toHaveBeenCalledOnce()
    expect(renderSecond).not.toHaveBeenCalled()
    views[1].element.value.focus()
    paletteOpen = true
    palette.focus()
    await utils.run()
    expect(renderSecond).toHaveBeenCalledOnce()
    paletteOpen = false
    utils.reconcile()
    expect(utils.available.value).toBe(false)
    views[0].element.value.focus()
    releaseFirst()
    expect(utils.available.value).toBe(false)
    await utils.run()
    expect(renderFirst).toHaveBeenCalledOnce()
  } finally {
    releaseSecond()
    utils.dispose()
    views.forEach((view) => view.element.value.remove())
    palette.remove()
    await registry.dispose()
  }
})

it('contributes a scoped command and a remappable keymap binding', async () => {
  const registry = new Registry()
  await registry.configure([editorsExtension, renderCommands])
  try {
    const command = registry
      .get(commandsFacet)
      .find((entry) => entry.id === KCL_RENDER_COMMAND)
    expect(command).toMatchObject({
      disabled: true,
      scopes: [KCL_RENDER_SCOPE],
    })
    expect(registry.get(keymapFacet).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: KCL_RENDER_COMMAND,
          command: KCL_RENDER_COMMAND,
          keystrokes: ['mod+s'],
          when: [KCL_RENDER_SCOPE],
        }),
      ])
    )
    const remapped = createKeymapTree(
      resolveKeymapItems(registry.get(keymapFacet).items, {
        version: 2,
        bindings: [
          {
            command: KCL_RENDER_COMMAND,
            keystrokes: ['mod+enter'],
            when: [KCL_RENDER_SCOPE],
          },
        ],
      })
    )
    expect(
      matchKeymapKeystrokes(remapped, [KCL_RENDER_SCOPE], ['mod+s'])
    ).toEqual({ type: 'none' })
    expect(
      matchKeymapKeystrokes(remapped, [KCL_RENDER_SCOPE], ['mod+enter'])
    ).toMatchObject({ type: 'full', item: { command: KCL_RENDER_COMMAND } })
    expect(matchKeymapKeystrokes(remapped, [], ['mod+enter'])).toEqual({
      type: 'none',
    })
  } finally {
    await registry.dispose()
  }
})
