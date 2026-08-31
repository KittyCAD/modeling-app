import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '@src/app/context'
import type {
  ProjectAction,
  ProjectActionHistory,
} from '@src/contracts/projectHistory'
import { projectHistoryService } from '@src/contracts/projectHistory'
import { HistoryPanel } from '@src/features/projectHistory/HistoryPanel'
import type { RevertOutcome } from '@src/lib/collab/revertContribution'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

const action = (overrides: Partial<ProjectAction> = {}): ProjectAction => ({
  id: 'action-1',
  label: 'Extruded profile001',
  at: Date.now(),
  author: null,
  paths: ['main.kcl'],
  ...overrides,
})

const setup = (
  options: {
    actions?: readonly ProjectAction[]
    revertible?: boolean
    outcome?: RevertOutcome
  } = {}
) => {
  const entries = signal<readonly ProjectAction[]>(options.actions ?? [])
  const revert = vi.fn(
    (): RevertOutcome =>
      options.outcome ?? { reverted: ['main.kcl'], missing: [], stranded: [] }
  )

  const history = {
    entries: computed(() => entries.value),
    undoable: computed(() => entries.value.at(-1) ?? null),
    record: vi.fn(),
    canRevert: () => computed(() => options.revertible ?? true),
    undoTargetFor: () => null,
    revert,
    forget: vi.fn(),
  } satisfies ProjectActionHistory

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [provideService(projectHistoryService, history)],
    }),
  ])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <HistoryPanel />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  return { element: host as HTMLDivElement, revert, entries }
}

const rows = (element: HTMLDivElement) =>
  Array.from(element.querySelectorAll('.zds-history__entry'))

describe('the history panel', () => {
  it('says what will appear when nothing has happened yet', () => {
    const app = setup()

    expect(app.element.textContent).toContain('Nothing has happened yet')
  })

  it('lists what happened, newest first', () => {
    const app = setup({
      actions: [
        action({ id: 'a', label: 'Extruded profile001', at: 1 }),
        action({ id: 'b', label: 'Zookeeper: add ribs', at: 2 }),
      ],
    })

    const labels = rows(app.element).map(
      (row) => row.querySelector('.zds-history__label')?.textContent
    )
    expect(labels).toEqual(['Zookeeper: add ribs', 'Extruded profile001'])
  })

  it('shows the files each one touched', () => {
    const app = setup({
      actions: [action({ paths: ['main.kcl', 'ribs.kcl'] })],
    })

    expect(app.element.textContent).toContain('main.kcl')
    expect(app.element.textContent).toContain('ribs.kcl')
  })

  /*
   * The demo case: concurrent writers have to be distinguishable at a glance, or
   * the panel is just a list.
   */
  it('gives concurrent authors different lanes and names them', () => {
    const app = setup({
      actions: [
        action({ id: 'a', author: null }),
        action({ id: 'b', author: 'zookeeper:8f2a1' }),
        action({ id: 'c', author: 'zookeeper:31bd7' }),
      ],
    })

    const lanes = rows(app.element).map((row) => row.getAttribute('data-lane'))
    expect(new Set(lanes).size).toBe(3)
    expect(app.element.textContent).toContain('zookeeper 8f2a')
    expect(app.element.textContent).toContain('zookeeper 31bd')
  })

  it('says nothing about authors when there is only one', () => {
    const app = setup({ actions: [action(), action({ id: 'b' })] })

    expect(app.element.querySelector('.zds-history__authors')).toBeNull()
  })

  it('reverts the action whose button was pressed', () => {
    const app = setup({
      actions: [action({ id: 'a' }), action({ id: 'b' })],
    })

    // Newest first, so the second row is the older action.
    const older = rows(app.element)[1]
    act(() => {
      older?.querySelector('button')?.click()
    })

    expect(app.revert).toHaveBeenCalledWith('a')
  })

  it('says what the revert actually did', () => {
    const app = setup({ actions: [action()] })

    act(() => {
      app.element.querySelector('button')?.click()
    })

    expect(app.element.textContent).toContain('Undone in main.kcl')
  })

  /*
   * Partial success is normal, and a revert that quietly did two thirds of itself
   * is worse than one that says so.
   */
  it('reports the files it could not undo and the text it kept', () => {
    const app = setup({
      actions: [action({ paths: ['main.kcl', 'ribs.kcl'] })],
      outcome: {
        reverted: ['main.kcl'],
        missing: ['ribs.kcl'],
        stranded: [{ path: 'main.kcl', from: 1, to: 2 } as never],
      },
    })

    act(() => {
      app.element.querySelector('button')?.click()
    })

    expect(app.element.textContent).toContain('Left alone: ribs.kcl')
    expect(app.element.textContent).toContain('Kept what was typed inside it')
  })

  /*
   * "Cannot" and "cannot exactly" are different claims, and only the second is
   * true — so the entry stays and says which.
   */
  it('keeps an entry it can no longer undo, and explains', () => {
    const app = setup({ actions: [action()], revertible: false })

    expect(rows(app.element)).toHaveLength(1)
    expect(app.element.textContent).toContain('no longer be undone exactly')
    expect(app.element.querySelector('button')).toBeNull()
  })
})
