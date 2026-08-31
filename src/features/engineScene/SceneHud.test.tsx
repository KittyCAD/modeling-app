import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals'
import type { LayoutService } from '@src/contracts/layout'
import { layoutService } from '@src/contracts/layout'
import { AppProvider } from '@src/app/context'
import { sceneHudSectionsValueSpec } from '@src/contracts/sceneHud'
import { SceneHud } from '@src/features/engineScene/SceneHud'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

let host: HTMLDivElement | null = null

afterEach(() => {
  if (host) {
    render(null, host)
  }
  host?.remove()
  host = null
})

describe('scene outline HUD', () => {
  it('stacks ordered contributions and lets each section fold independently', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(sceneHudSectionsValueSpec, {
            id: 'bodies',
            title: 'Bodies',
            order: 20,
            defaultCollapsed: true,
            render: () => <div>Body rows</div>,
          }),
          provide(sceneHudSectionsValueSpec, {
            id: 'features',
            title: 'Features',
            order: 0,
            render: () => <div>Operation rows</div>,
          }),
        ],
      }),
    ])

    host = document.createElement('div')
    document.body.appendChild(host)
    act(() =>
      render(
        <AppProvider value={{ registry, dispose: () => {} }}>
          <SceneHud />
        </AppProvider>,
        host as HTMLDivElement
      )
    )

    const sections = Array.from(
      host.querySelectorAll<HTMLElement>('[data-section-id]')
    )
    expect(sections.map((section) => section.dataset.sectionId)).toEqual([
      'features',
      'bodies',
    ])
    expect(sections[0].dataset.open).toBe('true')
    expect(sections[1].dataset.open).toBeUndefined()
    expect(host.textContent).toContain('Operation rows')

    act(() => {
      ;(
        host?.querySelector(
          '[data-section-id="features"] button'
        ) as HTMLElement
      ).click()
    })

    expect(sections[0].dataset.open).toBeUndefined()
    expect(sections[1].dataset.open).toBeUndefined()
  })

  it('collapses the whole outline to one small control', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(sceneHudSectionsValueSpec, {
            id: 'features',
            title: 'Features',
            order: 0,
            render: () => <div>Operation rows</div>,
          }),
        ],
      }),
    ])

    host = document.createElement('div')
    document.body.appendChild(host)
    act(() =>
      render(
        <AppProvider value={{ registry, dispose: () => {} }}>
          <SceneHud />
        </AppProvider>,
        host as HTMLDivElement
      )
    )

    act(() => {
      ;(
        host?.querySelector(
          'button[aria-label="Collapse scene outline"]'
        ) as HTMLElement
      ).click()
    })

    expect(host.querySelector('aside')?.dataset.collapsed).toBe('true')
    expect(host.textContent).not.toContain('Operation rows')
    expect(
      host.querySelector('button[aria-label="Expand scene outline"]')
    ).not.toBeNull()
  })
})

describe('resizing the outline', () => {
  /** A layout service with just the extent facility the HUD uses. */
  const withLayout = (extent = signal(208)) =>
    defineRegistryItem({
      providesServices: [
        provideService(layoutService, {
          extentFor: () => extent,
        } as unknown as LayoutService),
      ],
      provides: [
        provide(sceneHudSectionsValueSpec, {
          id: 'features',
          title: 'Features',
          order: 0,
          render: () => <div>Operation rows</div>,
        }),
      ],
    })

  const mount = (item: ReturnType<typeof defineRegistryItem>) => {
    const registry = new Registry()
    registry.configure([item])

    host = document.createElement('div')
    document.body.appendChild(host)
    act(() =>
      render(
        <AppProvider value={{ registry, dispose: () => {} }}>
          <SceneHud />
        </AppProvider>,
        host as HTMLDivElement
      )
    )
    return host
  }

  const handleOf = (element: HTMLElement) => {
    const handle = element.querySelector('.zds-scene-hud__resize')
    if (!(handle instanceof HTMLElement)) throw new Error('no resize handle')
    // happy-dom has no pointer capture, and the drag does not depend on it.
    handle.setPointerCapture = () => {}
    handle.releasePointerCapture = () => {}
    return handle
  }

  const drag = (handle: HTMLElement, from: number, to: number) => {
    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          bubbles: true,
          clientX: from,
          button: 0,
        })
      )
    })
    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: to })
      )
    })
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
  }

  it('takes its width from the persisted extent', () => {
    const element = mount(withLayout(signal(260)))
    const panel = element.querySelector('aside')

    expect(panel?.style.inlineSize).toBe('260px')
  })

  it('widens by however far the pointer moved', () => {
    const extent = signal(208)
    const element = mount(withLayout(extent))

    drag(handleOf(element), 100, 160)

    expect(extent.value).toBe(268)
  })

  it('will not be dragged narrower than it is readable', () => {
    const extent = signal(208)
    const element = mount(withLayout(extent))

    drag(handleOf(element), 100, -900)

    expect(extent.value).toBe(140)
  })

  it('will not be dragged wider than the model it covers', () => {
    const extent = signal(208)
    const element = mount(withLayout(extent))

    drag(handleOf(element), 100, 5000)

    expect(extent.value).toBe(520)
  })

  it('stops following the pointer once the drag ends', () => {
    const extent = signal(208)
    const element = mount(withLayout(extent))
    const handle = handleOf(element)

    drag(handle, 100, 150)
    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 400 })
      )
    })

    expect(extent.value).toBe(258)
  })

  it('goes back to its default on a double click', () => {
    const extent = signal(400)
    const element = mount(withLayout(extent))

    act(() => {
      handleOf(element).dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true })
      )
    })

    expect(extent.value).toBe(208)
  })

  it('has no handle while it is collapsed', () => {
    const element = mount(withLayout())
    const collapse = element.querySelector('.zds-scene-hud__collapse')

    act(() => {
      ;(collapse as HTMLElement).click()
    })

    // Nothing to resize, and a strip beside a 24px square would be in the way.
    expect(element.querySelector('.zds-scene-hud__resize')).toBeNull()
  })
})
