import { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import type { BufferStructuralContext } from '@src/contracts/buffers'
import type { KeybindingService } from '@src/contracts/keybindings'
import {
  CODE_EDITOR_SCOPE,
  createKeymapScopeCapability,
  editorHasFocus,
} from '@src/features/editorCapabilities/keymapScope'

const fakeKeys = () => {
  const active = signal<readonly string[]>([])
  const service = {
    activeScopes: active,
    applyScope: (id: string) => {
      if (!active.value.includes(id)) active.value = [...active.value, id]
    },
    removeScope: (id: string) => {
      active.value = active.value.filter((held) => held !== id)
    },
  } as unknown as KeybindingService

  return { service, active }
}

const views: EditorView[] = []

const mount = (keys: KeybindingService) => {
  const capability = createKeymapScopeCapability({ keys: () => keys })
  const extension = capability.extension?.({} as BufferStructuralContext) ?? []
  const view = new EditorView({ doc: '', extensions: [extension] })
  views.push(view)
  return view
}

/** CodeMirror listens on the content element, which is what a caret is in. */
const focus = (view: EditorView) =>
  view.contentDOM.dispatchEvent(new FocusEvent('focus'))
const blur = (view: EditorView) =>
  view.contentDOM.dispatchEvent(new FocusEvent('blur'))

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

describe('the scope a focused editor holds', () => {
  it('applies while the editor has the keyboard', () => {
    const keys = fakeKeys()
    const view = mount(keys.service)

    focus(view)

    expect(keys.active.value).toContain(CODE_EDITOR_SCOPE)
    expect(editorHasFocus(keys.service)).toBe(true)
  })

  it('releases it on blur', () => {
    const keys = fakeKeys()
    const view = mount(keys.service)

    focus(view)
    blur(view)

    expect(keys.active.value).not.toContain(CODE_EDITOR_SCOPE)
  })

  /*
   * The bug: a focused element that is *removed* fires no blur, so closing the
   * code panel left the app convinced somebody was still typing in it — and
   * anything reading "where is the user" from that could not be got out of it.
   */
  it('releases it when the view goes away without blurring', () => {
    const keys = fakeKeys()
    const view = mount(keys.service)
    focus(view)

    view.destroy()

    expect(keys.active.value).not.toContain(CODE_EDITOR_SCOPE)
  })

  it('does nothing on teardown of a view that never had focus', () => {
    const keys = fakeKeys()
    const held = mount(keys.service)
    const other = mount(keys.service)
    focus(held)

    // Closing a second editor must not take the scope from the first: ownership
    // is per view, not global.
    other.destroy()

    expect(keys.active.value).toContain(CODE_EDITOR_SCOPE)
  })

  it('reports no focus before anything is focused', () => {
    const keys = fakeKeys()
    mount(keys.service)

    expect(editorHasFocus(keys.service)).toBe(false)
  })
})
