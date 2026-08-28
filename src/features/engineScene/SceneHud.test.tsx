import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
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
})
