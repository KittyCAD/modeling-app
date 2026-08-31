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
  AnySetting,
  SettingsLevel,
  SettingsService,
} from '@src/contracts/settings'
import { settingsService } from '@src/contracts/settings'
import { SettingsDialog } from '@src/features/settings/SettingsDialog'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

const setting = (
  id: string,
  title: string,
  extra: Partial<AnySetting> = {}
): AnySetting =>
  ({
    id,
    section: id.split('.')[0],
    title,
    defaultValue: false,
    control: { kind: 'boolean' },
    toml: ['settings', ...id.split('.')],
    ...extra,
  }) as AnySetting

const sections = [
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'How the app looks.',
    settings: [
      setting('appearance.theme', 'Colour theme'),
      setting('appearance.density', 'Density'),
    ],
  },
  {
    id: 'modeling',
    title: 'Modeling',
    settings: [setting('modeling.projection', 'Projection')],
  },
]

const setup = () => {
  const openSection = signal<string | null>('appearance')
  const focusSearch = signal(0)
  const level = signal<SettingsLevel>('user')

  const service = {
    sections: computed(() => sections),
    hydrated: computed(() => true),
    error: computed(() => null),
    levels: [
      {
        level: 'user' as const,
        label: 'You',
        location: computed(() => '/home/user.toml'),
        unavailableReason: computed(() => null),
      },
    ],
    value: () => computed(() => false),
    read: () => false,
    overrideAt: () => computed(() => undefined),
    inheritedAt: () => computed(() => false),
    set: vi.fn(),
    clear: vi.fn(),
    supportsLevel: () => true,
    openSection: computed(() => openSection.value),
    open: (id?: string) => {
      openSection.value = id ?? 'appearance'
    },
    close: () => {
      openSection.value = null
    },
  } as unknown as SettingsService

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [provideService(settingsService, service)],
    }),
  ])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <SettingsDialog level={level} focusSearch={focusSearch} />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  const element = host as HTMLDivElement
  const search = element.querySelector('input') as HTMLInputElement

  const type = (text: string) =>
    act(() => {
      search.value = text
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

  return { element, search, type, focusSearch, openSection }
}

const rowTitles = (element: HTMLDivElement) =>
  Array.from(element.querySelectorAll('.zds-setting__name'))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)

const headings = (element: HTMLDivElement) =>
  Array.from(element.querySelectorAll('.zds-settings__result-heading')).map(
    (node) => node.textContent?.trim()
  )

describe('the settings search', () => {
  it('sits in the sidebar, above the groups', () => {
    const app = setup()

    const nav = app.element.querySelector('.zds-settings__nav')
    expect(nav?.querySelector('.zds-settings__search')).not.toBeNull()
    expect(nav?.firstElementChild?.className).toContain('zds-settings__search')
  })

  /* Nothing typed is the dialog it has always been. */
  it('shows the open group until somebody types', () => {
    const app = setup()

    expect(app.element.querySelector('.zds-settings__results')).toBeNull()
    expect(app.element.textContent).toContain('How the app looks.')
  })

  it('replaces the pane with matches, grouped by where they live', () => {
    const app = setup()

    app.type('projection')

    expect(headings(app.element)).toEqual(['Modeling'])
    expect(rowTitles(app.element)).toEqual(['Projection'])
  })

  it('searches across every group, not just the open one', () => {
    const app = setup()

    app.type('projection')

    // The open section is Appearance; the hit is in Modeling.
    expect(app.element.textContent).toContain('Projection')
  })

  it('says so when nothing matches', () => {
    const app = setup()

    app.type('kerning')

    expect(app.element.textContent).toContain('Nothing matches')
  })

  /*
   * A group that vanishes as you type takes the map of what there is to
   * configure with it, which is most of what the sidebar is for.
   */
  it('dims groups with no matches rather than removing them', () => {
    const app = setup()

    app.type('projection')

    const nav = Array.from(
      app.element.querySelectorAll('.zds-settings__nav-item')
    )
    expect(nav).toHaveLength(2)
    const dimmed = nav.find((item) => item.textContent?.includes('Appearance'))
    expect(dimmed?.getAttribute('data-quiet')).toBe('true')
  })

  it('counts what each group contributed', () => {
    const app = setup()

    app.type('appearance')

    expect(
      app.element.querySelector('.zds-settings__nav-count')?.textContent
    ).toBe('2')
  })

  /* Having found the setting, the next thing wanted is often the rest of it. */
  it('goes to a group when its heading is clicked, and drops the search', () => {
    const app = setup()
    app.type('projection')

    act(() => {
      app.element
        .querySelector<HTMLElement>('.zds-settings__result-heading')
        ?.click()
    })

    expect(app.element.querySelector('.zds-settings__results')).toBeNull()
    expect(app.search.value).toBe('')
    expect(app.openSection.value).toBe('modeling')
  })

  /*
   * Escape everywhere else means "clear this field". Closing the dialog on it
   * would lose the place somebody was in to a reflex.
   */
  it('clears the query on Escape before closing', () => {
    const app = setup()
    app.type('projection')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(app.openSection.value).not.toBeNull()
    expect(app.element.querySelector('.zds-settings__results')).toBeNull()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(app.openSection.value).toBeNull()
  })
})

describe('asking for the search field', () => {
  /*
   * The field does not take focus on open, so that arrow keys still mean what
   * they usually mean. Somebody who wants to search says so.
   */
  it('does not steal the caret when the dialog opens', () => {
    const app = setup()

    expect(document.activeElement).not.toBe(app.search)
  })

  it('takes it when the keystroke asks', () => {
    const app = setup()

    act(() => {
      app.focusSearch.value += 1
    })

    expect(document.activeElement).toBe(app.search)
  })

  /* Asking twice has to work twice, which a boolean could not express. */
  it('answers a second request, selecting what is there to replace it', () => {
    const app = setup()
    app.type('projection')

    act(() => {
      app.focusSearch.value += 1
    })
    act(() => {
      app.search.blur()
      app.focusSearch.value += 1
    })

    expect(document.activeElement).toBe(app.search)
    expect(app.search.selectionStart).toBe(0)
    expect(app.search.selectionEnd).toBe('projection'.length)
  })
})
