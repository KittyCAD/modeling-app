import { defineRegistryItem, Registry } from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { AppProvider } from '@src/app/context'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ProjectSessionService } from '@src/contracts/projectSession'
import { FileMenu } from '@src/features/shell/Crumbs'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

const buffer = (id: string, name: string) =>
  ({ id, name: signal(name) }) as unknown as FileBackedTextBuffer

function setup(options: { active?: string | null; executing?: string | null }) {
  const buffers = [buffer('a', 'main.kcl'), buffer('b', 'lid.kcl')]
  const find = (id: string | null | undefined) =>
    buffers.find((item) => item.id === id) ?? null

  const session = {
    current: computed(() => ({
      activeBuffer: computed(() => find(options.active)),
      executingBuffer: computed(() => find(options.executing)),
      files: computed(() => []),
      filesState: computed(() => 'ready' as const),
      relativePathFor: (target: FileBackedTextBuffer) =>
        `src/${target.name.value}`,
      openFile: async () => buffers[0] as FileBackedTextBuffer,
      setExecutingBuffer: () => {},
    })),
    // Never announced in these tests; present so the real consumers can
    // subscribe without the stub throwing.
    onProjectGone: () => () => {},
  } as unknown as ProjectSessionService

  const registry = new Registry()
  registry.configure([defineRegistryItem({ provides: [] })])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <FileMenu session={session} />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  return (host as HTMLDivElement).querySelector('.zds-crumbs__file')
}

describe('the file crumb', () => {
  /*
   * It used to show the active buffer, which made the label the only part of the
   * control that meant something else: the menu says "choose the file to
   * execute", marks the executing one, and sets it on choosing.
   */
  it('names the executing file, not the one being read', () => {
    const crumb = setup({ active: 'b', executing: 'a' })
    expect(crumb?.textContent).toBe('src/main.kcl')
  })

  it('keeps naming it when nothing is being read', () => {
    const crumb = setup({ active: null, executing: 'a' })
    expect(crumb?.textContent).toBe('src/main.kcl')
  })

  it('asks for one when nothing is executing', () => {
    // Even with a file open: an open file is not a file being built.
    const crumb = setup({ active: 'b', executing: null })
    expect(crumb?.textContent).toBe('Choose a file')
  })
})
