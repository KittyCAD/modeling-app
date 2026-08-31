import { defineRegistryItem, Registry } from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { AppProvider } from '@src/app/context'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ProjectSession } from '@src/contracts/projectSession'
import { BufferTabs } from '@src/features/project/areas/BufferTabs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

const buffer = (
  id: string,
  name: string,
  options: { dirty?: boolean; languageId?: string } = {}
) =>
  ({
    id,
    name: signal(name),
    dirty: signal(options.dirty ?? false),
    languageId: signal(options.languageId ?? 'kcl'),
  }) as unknown as FileBackedTextBuffer

function setup(
  options: {
    buffers?: FileBackedTextBuffer[]
    activeId?: string | null
    executingId?: string | null
  } = {}
) {
  const buffers = options.buffers ?? [
    buffer('a', 'main.kcl'),
    buffer('b', 'lid.kcl'),
  ]
  const activeId = signal(options.activeId ?? 'a')
  const executingId = signal(
    options.executingId === undefined ? 'a' : options.executingId
  )

  const setActiveBuffer = vi.fn((id: string) => {
    activeId.value = id
  })
  const closeBuffer = vi.fn()

  const session = {
    buffers: computed(() => buffers),
    activeBuffer: computed(
      () => buffers.find((item) => item.id === activeId.value) ?? null
    ),
    executingBuffer: computed(
      () => buffers.find((item) => item.id === executingId.value) ?? null
    ),
    setActiveBuffer,
    closeBuffer,
    relativePathFor: (target: FileBackedTextBuffer) =>
      `src/${target.name.value}`,
  } as unknown as ProjectSession

  const registry = new Registry()
  registry.configure([defineRegistryItem({ provides: [] })])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <BufferTabs session={session} />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  const tabs = () =>
    Array.from(
      (host as HTMLDivElement).querySelectorAll<HTMLElement>('[role="tab"]')
    )

  return { host: host as HTMLDivElement, tabs, setActiveBuffer, closeBuffer }
}

describe('buffer tabs', () => {
  it('shows one tab per open buffer, in the order they were opened', () => {
    const app = setup()
    expect(app.tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'main.kcl',
      'lid.kcl',
    ])
  })

  it('selects on click', () => {
    const app = setup()

    act(() => app.tabs()[1]?.click())

    expect(app.setActiveBuffer).toHaveBeenCalledWith('b')
  })

  it('marks the selected tab', () => {
    const app = setup({ activeId: 'b' })
    const [first, second] = app.tabs()

    expect(first?.getAttribute('aria-selected')).toBe('false')
    expect(second?.getAttribute('aria-selected')).toBe('true')
  })

  /*
   * The distinction the whole app is built on: a tab says what you are reading,
   * and exactly one file — not necessarily that one — is what the engine builds.
   */
  it('marks the executing file separately from the selected one', () => {
    const app = setup({ activeId: 'b', executingId: 'a' })
    const [first, second] = app.tabs()

    expect(first?.dataset.executing).toBe('true')
    expect(first?.dataset.active).toBeUndefined()
    expect(second?.dataset.active).toBe('true')
    expect(second?.dataset.executing).toBeUndefined()
  })

  it('closes from the tab’s own button, without selecting it first', () => {
    const app = setup({ activeId: 'a' })
    const close = app.tabs()[1]?.querySelector('button')

    act(() => (close as HTMLButtonElement).click())

    expect(app.closeBuffer).toHaveBeenCalledWith('b')
    // Selecting a tab on the way to closing it is visible, and wrong.
    expect(app.setActiveBuffer).not.toHaveBeenCalled()
  })

  it('closes on a middle click, as tabs do everywhere', () => {
    const app = setup()

    act(() => {
      app
        .tabs()[1]
        ?.dispatchEvent(
          new MouseEvent('auxclick', { bubbles: true, button: 1 })
        )
    })

    expect(app.closeBuffer).toHaveBeenCalledWith('b')
  })

  it('ignores an aux click that is not the middle button', () => {
    const app = setup()

    act(() => {
      app
        .tabs()[1]
        ?.dispatchEvent(
          new MouseEvent('auxclick', { bubbles: true, button: 2 })
        )
    })

    expect(app.closeBuffer).not.toHaveBeenCalled()
  })

  it('shows unsaved work without hiding the way to close it', () => {
    const app = setup({
      buffers: [buffer('a', 'main.kcl', { dirty: true })],
    })
    const tab = app.tabs()[0]

    expect(tab?.querySelector('.zds-tabs__dirty')).not.toBeNull()
    // Editors that swap the dot for the close button cost you the ability to
    // close a dirty file without first learning that the dot is a button.
    expect(tab?.querySelector('.zds-tabs__close')).not.toBeNull()
  })

  it('carries the path on the tooltip, since a name is often ambiguous', () => {
    const app = setup({ executingId: 'a' })
    expect(app.tabs()[0]?.title).toBe('src/main.kcl · Executing')
  })

  /*
   * Automatic activation: arrowing through tabs shows each file as you pass it,
   * which is what an editor's tab strip does. Move-then-Enter is for tablists
   * where switching is expensive.
   */
  it('moves the selection with the arrow keys', () => {
    const app = setup({ activeId: 'a' })

    act(() => {
      app
        .tabs()[0]
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
        )
    })

    expect(app.setActiveBuffer).toHaveBeenCalledWith('b')
  })

  it('stops at the ends rather than wrapping', () => {
    const app = setup({ activeId: 'a' })

    act(() => {
      app
        .tabs()[0]
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
        )
    })

    expect(app.setActiveBuffer).not.toHaveBeenCalled()
  })

  it('keeps one stop in the tab order, not one per file', () => {
    const app = setup({ activeId: 'b' })
    expect(app.tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0])
  })
})
