import { defineRegistryItem, provide, Registry } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID,
  ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE,
  defineEngineSceneHudArea,
  defineEngineSceneHudAreaToggleKeymapItem,
  type EngineSceneExtensionContext,
  EngineSceneHud,
  type EngineSceneHudArea,
  type EngineSceneHudAreaToggleRequest,
  type EngineSceneModelTreeHudService,
  engineSceneHudAreasValueSpec,
  resolveEngineSceneHudAreas,
} from '@src/registry/contracts/engineScene'
import type { KeymapService } from '@src/registry/contracts/keymap'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const context = {
  modelingState: {
    matches: () => false,
  },
  modelingSend: vi.fn(),
  sketchSolveStreamDimming: 0.3,
  setSketchSolveStreamDimming: vi.fn(),
} as unknown as EngineSceneExtensionContext

function createHudService(
  expanded = signal(true)
): EngineSceneModelTreeHudService {
  const focused = signal(false)
  const focusRequest = signal(0)
  const areaToggleRequest = signal<EngineSceneHudAreaToggleRequest | null>(null)
  let areaToggleRequestId = 0

  return {
    expanded,
    focused,
    focusRequest,
    areaToggleRequest,
    expand: () => {
      expanded.value = true
    },
    collapse: () => {
      expanded.value = false
      focused.value = false
    },
    toggle: () => {
      const shouldExpand = !expanded.value
      expanded.value = shouldExpand
      if (!shouldExpand) {
        focused.value = false
      }
    },
    focus: () => {
      expanded.value = true
      focusRequest.value += 1
    },
    setFocused: (nextFocused) => {
      focused.value = nextFocused
    },
    toggleArea: (areaId) => {
      expanded.value = true
      areaToggleRequest.value = {
        areaId,
        requestId: ++areaToggleRequestId,
      }
    },
  }
}

function createKeymapService(): KeymapService {
  return {
    applyScope: vi.fn(),
    removeScope: vi.fn(),
  } as unknown as KeymapService
}

function hudArea(
  area: Partial<EngineSceneHudArea> & Pick<EngineSceneHudArea, 'id' | 'title'>
): EngineSceneHudArea {
  const label = area.title

  return defineEngineSceneHudArea({
    toggleKeymap: {
      id: `${area.id}.toggle`,
      title: `Toggle ${area.title}`,
      keystrokes: [area.title.slice(0, 1).toLocaleLowerCase()],
    },
    Component: () => (
      <div data-testid={`engine-scene-hud-area-${area.id}-content`}>
        {label} content
      </div>
    ),
    ...area,
  })
}

function getHudAreaIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-engine-scene-hud-area-id]')
  ).map((element) => element.dataset.engineSceneHudAreaId ?? '')
}

function getCollapsedTooltipAreaIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-engine-scene-hud-tooltip-area-id]'
    )
  ).map((element) => element.dataset.engineSceneHudTooltipAreaId ?? '')
}

describe('engine scene HUD areas', () => {
  it('orders, dedupes, and conditionally resolves HUD area contributions', () => {
    const registry = new Registry()
    const first = hudArea({
      id: 'duplicate',
      title: 'First duplicate',
      order: 20,
    })
    const second = hudArea({
      id: 'middle',
      title: 'Middle',
      order: 10,
    })
    const duplicate = hudArea({
      id: 'duplicate',
      title: 'Ignored duplicate',
      order: 0,
    })
    const hidden = hudArea({
      id: 'hidden',
      title: 'Hidden',
      order: 5,
      shouldRegister: () => false,
    })

    registry.configure([
      defineRegistryItem({
        provides: [
          provide(engineSceneHudAreasValueSpec, first, { key: 'first' }),
          provide(engineSceneHudAreasValueSpec, second, { key: 'second' }),
          provide(engineSceneHudAreasValueSpec, duplicate, {
            key: 'duplicate',
          }),
          provide(engineSceneHudAreasValueSpec, hidden, { key: 'hidden' }),
        ],
      }),
    ])

    const areas = registry.get(engineSceneHudAreasValueSpec)
    expect(areas.map((area) => area.id)).toEqual([
      'hidden',
      'middle',
      'duplicate',
    ])
    expect(areas.find((area) => area.id === 'duplicate')?.title).toBe(
      'First duplicate'
    )

    expect(
      resolveEngineSceneHudAreas(areas, context).map((area) => area.id)
    ).toEqual(['middle', 'duplicate'])
  })

  it('creates focused-scope toggle keymap items for HUD areas', () => {
    expect(
      defineEngineSceneHudAreaToggleKeymapItem(
        hudArea({
          id: 'test-area',
          title: 'Test Area',
          toggleKeymap: {
            id: 'test-area.toggle',
            title: 'Toggle test area',
            keystrokes: ['t'],
          },
        }),
        'Test source'
      )
    ).toEqual({
      id: 'test-area.toggle',
      title: 'Toggle test area',
      source: 'Test source',
      scopes: [ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE],
      keystrokes: ['t'],
      command: ENGINE_SCENE_HUD_AREA_TOGGLE_COMMAND_ID,
      arguments: {
        areaId: 'test-area',
      },
    })
  })

  it('renders an expanded disclosure stack and a collapsed rail with stable area state', async () => {
    const service = createHudService()
    const onSceneClick = vi.fn()
    const onSceneMouseDown = vi.fn()

    render(
      <div onClick={onSceneClick} onMouseDown={onSceneMouseDown}>
        <EngineSceneHud
          areas={[
            hudArea({
              id: 'fallback-icon',
              title: 'Fallback',
              order: 20,
            }),
            hudArea({
              id: 'body-area',
              title: 'Body Area',
              icon: 'body',
              order: 10,
            }),
          ]}
          service={service}
          {...context}
        />
      </div>
    )

    const hud = screen.getByTestId('engine-scene-model-tree-hud')
    expect(hud).toBeVisible()
    expect(
      within(hud).queryByTestId('engine-scene-model-tree-hud-icon')
    ).toBeNull()
    expect(getHudAreaIds(hud)).toEqual(['body-area', 'fallback-icon'])
    expect(
      screen.getByTestId('engine-scene-hud-area-body-area-content')
    ).toBeVisible()
    expect(
      screen.getByTestId('engine-scene-hud-area-fallback-icon-content')
    ).toBeVisible()

    const bodyAreaToggle = within(hud).getByTestId(
      'engine-scene-hud-area-body-area-toggle'
    )
    expect(bodyAreaToggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.mouseDown(bodyAreaToggle)
    fireEvent.click(bodyAreaToggle)
    expect(onSceneMouseDown).not.toHaveBeenCalled()
    expect(onSceneClick).not.toHaveBeenCalled()
    expect(bodyAreaToggle).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByTestId('engine-scene-hud-area-body-area-content')
    ).toBeNull()

    fireEvent.click(
      within(hud).getByTestId('engine-scene-model-tree-hud-collapse')
    )
    const collapsed = screen.getByTestId(
      'engine-scene-model-tree-hud-collapsed'
    )
    expect(collapsed).toBeVisible()
    expect(
      within(collapsed).getByTestId(
        'engine-scene-model-tree-hud-collapsed-label'
      )
    ).toBeVisible()
    expect(
      within(collapsed).getByTestId('engine-scene-model-tree-hud-expand')
    ).toBeVisible()
    expect(
      within(collapsed).queryByTestId('engine-scene-model-tree-hud-icon')
    ).toBeNull()
    expect(
      within(collapsed).getByTestId(
        'engine-scene-model-tree-hud-toggle-keybinding-tooltip'
      )
    ).toBeInTheDocument()
    expect(getCollapsedTooltipAreaIds(collapsed)).toEqual([
      'body-area',
      'fallback-icon',
    ])
    expect(
      within(collapsed).getByTestId(
        'engine-scene-model-tree-hud-tooltip-area-body-area-keybinding'
      )
    ).toBeInTheDocument()

    act(() => {
      service.expand()
    })
    await waitFor(() =>
      expect(screen.getByTestId('engine-scene-model-tree-hud')).toBeVisible()
    )
    expect(
      screen.queryByTestId('engine-scene-hud-area-body-area-content')
    ).toBeNull()
    expect(
      screen.getByTestId('engine-scene-hud-area-fallback-icon-content')
    ).toBeVisible()
  })

  it('applies the HUD keymap scope only while the expanded HUD is focused', () => {
    const service = createHudService()
    const keymap = createKeymapService()

    render(
      <div>
        <button type="button" data-testid="outside-button">
          Outside
        </button>
        <EngineSceneHud
          areas={[
            hudArea({
              id: 'feature-area',
              title: 'Feature Area',
              order: 0,
            }),
          ]}
          service={service}
          keymap={keymap}
          {...context}
        />
      </div>
    )

    const hud = screen.getByTestId('engine-scene-model-tree-hud')
    const outside = screen.getByTestId('outside-button')

    expect(
      within(hud).queryByTestId('engine-scene-model-tree-hud-toggle-keybinding')
    ).toBeNull()
    expect(
      screen.queryByTestId('engine-scene-hud-area-feature-area-keybinding')
    ).toBeNull()

    fireEvent.focus(hud)

    expect(service.focused.value).toBe(true)
    expect(keymap.applyScope).toHaveBeenCalledWith(
      ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE
    )
    expect(
      within(hud).queryByTestId('engine-scene-model-tree-hud-toggle-keybinding')
    ).toBeNull()
    expect(
      screen.queryByTestId('engine-scene-hud-area-feature-area-keybinding')
    ).toBeNull()

    fireEvent.blur(hud, { relatedTarget: outside })

    Object.defineProperty(hud, 'matches', {
      configurable: true,
      value: vi.fn((selector: string) => selector === ':focus-visible'),
    })
    fireEvent.focus(hud)

    expect(
      within(hud).getByTestId('engine-scene-model-tree-hud-toggle-keybinding')
    ).toBeVisible()
    expect(
      screen.getByTestId('engine-scene-hud-area-feature-area-keybinding')
    ).toBeVisible()

    fireEvent.blur(hud, { relatedTarget: outside })

    expect(service.focused.value).toBe(false)
    expect(keymap.removeScope).toHaveBeenCalledWith(
      ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE
    )
    expect(
      screen.queryByTestId('engine-scene-hud-area-feature-area-keybinding')
    ).toBeNull()

    fireEvent.focus(hud)
    fireEvent.click(
      within(hud).getByTestId('engine-scene-model-tree-hud-collapse')
    )

    expect(service.expanded.value).toBe(false)
    expect(service.focused.value).toBe(false)
    expect(keymap.removeScope).toHaveBeenCalledWith(
      ENGINE_SCENE_MODEL_TREE_HUD_KEYMAP_SCOPE
    )
  })

  it('toggles area disclosures from model-tree HUD service requests', () => {
    const service = createHudService()

    render(
      <EngineSceneHud
        areas={[
          hudArea({
            id: 'feature-area',
            title: 'Feature Area',
            order: 0,
          }),
          hudArea({
            id: 'body-area',
            title: 'Body Area',
            order: 10,
          }),
        ]}
        service={service}
        {...context}
      />
    )

    expect(
      screen.getByTestId('engine-scene-hud-area-feature-area-content')
    ).toBeVisible()
    expect(
      screen.getByTestId('engine-scene-hud-area-body-area-content')
    ).toBeVisible()

    act(() => {
      service.toggleArea('feature-area')
    })

    expect(
      screen.queryByTestId('engine-scene-hud-area-feature-area-content')
    ).toBeNull()
    expect(
      screen.getByTestId('engine-scene-hud-area-body-area-content')
    ).toBeVisible()

    act(() => {
      service.toggleArea('feature-area')
    })

    expect(
      screen.getByTestId('engine-scene-hud-area-feature-area-content')
    ).toBeVisible()
  })

  it('renders the collapsed HUD without an icon and lists registered areas', () => {
    const expanded = signal(false)

    render(
      <EngineSceneHud
        areas={[
          hudArea({
            id: 'fallback-icon',
            title: 'Fallback',
            order: 0,
          }),
        ]}
        service={createHudService(expanded)}
        {...context}
      />
    )

    const collapsed = screen.getByTestId(
      'engine-scene-model-tree-hud-collapsed'
    )
    expect(
      within(collapsed).queryByTestId('engine-scene-model-tree-hud-icon')
    ).toBeNull()
    expect(getCollapsedTooltipAreaIds(collapsed)).toEqual(['fallback-icon'])
    expect(
      within(collapsed).getByTestId(
        'engine-scene-model-tree-hud-toggle-keybinding-tooltip'
      )
    ).toBeInTheDocument()
  })
})
