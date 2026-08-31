import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProvider } from '@src/app/context'
import type {
  DefaultPlaneName,
  DefaultPlaneView,
  DefaultPlanesService,
  PlaneVisibility,
} from '@src/contracts/defaultPlanes'
import { defaultPlanesService } from '@src/contracts/defaultPlanes'
import { PlanesSection } from '@src/features/defaultPlanes/PlanesSection'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) render(null, host)
  host?.remove()
  host = null
})

const plane = (
  name: DefaultPlaneName,
  title: string,
  overrides: Partial<DefaultPlaneView> = {}
): DefaultPlaneView => ({
  name,
  title,
  visible: true,
  visibility: 'auto',
  back: name.startsWith('neg'),
  ...overrides,
})

const setup = (
  options: {
    planes?: readonly DefaultPlaneView[]
    available?: boolean
    empty?: boolean
    overridden?: boolean
  } = {}
) => {
  const set = vi.fn()
  const resetOverrides = vi.fn()

  const service = {
    planes: computed(
      () =>
        options.planes ?? [
          plane('xy', 'XY'),
          plane('negXy', '-XY', { visible: false }),
        ]
    ),
    sceneIsEmpty: computed(() => options.empty ?? true),
    available: computed(() => options.available ?? true),
    overridden: computed(() => options.overridden ?? false),
    set,
    resetOverrides,
  } satisfies DefaultPlanesService

  const registry = new Registry()
  registry.configure([
    defineRegistryItem({
      providesServices: [provideService(defaultPlanesService, service)],
    }),
  ])

  host = document.createElement('div')
  document.body.appendChild(host)
  act(() =>
    render(
      <AppProvider value={{ registry, dispose: () => {} }}>
        <PlanesSection />
      </AppProvider>,
      host as HTMLDivElement
    )
  )

  return { element: host as HTMLDivElement, set, resetOverrides }
}

const rows = (element: HTMLDivElement) =>
  Array.from(element.querySelectorAll('.zds-planes__row'))

describe('the planes section', () => {
  it('lists the planes it was given', () => {
    const app = setup()

    expect(rows(app.element)).toHaveLength(2)
    expect(app.element.textContent).toContain('XY')
  })

  /*
   * The planes are made by a run, so before one there is nothing to toggle — and
   * six dead rows would be worse than saying so.
   */
  it('says why there is nothing before a run', () => {
    const app = setup({ available: false })

    expect(rows(app.element)).toHaveLength(0)
    expect(app.element.textContent).toContain('created by a run')
  })

  it('turns a visible plane off', () => {
    const app = setup({ planes: [plane('xy', 'XY', { visible: true })] })

    act(() => {
      app.element.querySelector<HTMLElement>('.zds-planes__visibility')?.click()
    })

    expect(app.set).toHaveBeenCalledWith(
      'xy',
      'hidden' satisfies PlaneVisibility
    )
  })

  it('turns a hidden plane on', () => {
    const app = setup({ planes: [plane('negXy', '-XY', { visible: false })] })

    act(() => {
      app.element.querySelector<HTMLElement>('.zds-planes__visibility')?.click()
    })

    expect(app.set).toHaveBeenCalledWith('negXy', 'shown')
  })

  /*
   * A plane that appears and disappears on its own is something to argue with
   * unless the panel says why.
   */
  it('says the planes are showing because the scene is empty', () => {
    const app = setup({ empty: true })

    expect(app.element.textContent).toContain('while the scene is empty')
  })

  it('says they are hidden because there is geometry', () => {
    const app = setup({ empty: false })

    expect(app.element.textContent).toContain('while there is geometry')
  })

  /* The third state, which the existing app has no way to express. */
  it('marks a plane that has been set by hand', () => {
    const app = setup({
      planes: [plane('xy', 'XY', { visibility: 'hidden', visible: false })],
      overridden: true,
    })

    expect(app.element.querySelector('.zds-planes__badge')).not.toBeNull()
    expect(app.element.textContent).toContain('set by hand')
  })

  it('offers a way back to automatic, and only when there is one', () => {
    expect(
      setup({ overridden: false }).element.querySelector('.zds-planes__reset')
    ).toBeNull()

    if (host) render(null, host)
    const app = setup({ overridden: true })
    act(() => {
      app.element.querySelector<HTMLElement>('.zds-planes__reset')?.click()
    })

    expect(app.resetOverrides).toHaveBeenCalled()
  })

  it('marks the back faces, which nothing shows unasked', () => {
    const app = setup()

    const back = rows(app.element).filter(
      (row) => row.getAttribute('data-back') === 'true'
    )
    expect(back).toHaveLength(1)
  })
})
