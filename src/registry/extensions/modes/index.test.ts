import {
  Registry,
  Slot,
  createPlugin,
  defineRegistryItem,
  pluginsValueSpec,
  provide,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  type ModeDefinition,
  modesService,
  modesValueSpec,
  provideMode,
} from '@src/registry/contracts/modes'
import { modesExtension } from '@src/registry/extensions/modes'
import { afterEach, describe, expect, it } from 'vitest'

const modeling: ModeDefinition = {
  id: 'modeling',
  label: 'Modeling',
  toolbar: 'modeling',
}
const review: ModeDefinition = {
  id: 'review',
  label: 'Review',
  toolbar: [],
}
const sketchModes: ModeDefinition[] = [
  {
    id: 'sketching',
    label: 'Sketch',
    toolbar: 'sketching',
    selectable: false,
  },
  {
    id: 'sketchSolve',
    label: 'Sketch',
    toolbar: 'sketchSolve',
    selectable: false,
  },
  {
    id: 'onlyCancel',
    label: 'Sketch',
    toolbar: 'onlyCancel',
    selectable: false,
  },
]
const builtinModes = defineRegistryItem({
  provides: [modeling, ...sketchModes].map((mode) => provideMode(mode)),
})

describe('registry modes', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  function setup() {
    const modeSlot = new Slot()
    const plugin = createPlugin({
      id: 'review-plugin',
      title: 'Review',
      description: 'Review the current model.',
      items: [defineRegistryItem({ provides: [provideMode(review)] })],
    })
    const container = new Registry()
    registry = container
    container.configure([builtinModes, modesExtension, modeSlot.of(plugin)])
    return {
      container,
      service: container.get(modesService),
      modeSlot,
      plugin,
    }
  }

  it('selects a plugin toolbar without requiring a custom scene', () => {
    const { service } = setup()

    expect(service.activeMode.value).toBe(modeling)
    expect(service.setMode(review.id)).toBe(true)
    expect(service.selectedModeId.value).toBe(review.id)
    expect(service.activeMode.value?.toolbar).toBe(review.toolbar)
    expect(service.activeMode.value?.Scene).toBeUndefined()
  })

  it('rejects unknown and machine-driven modes without changing selection', () => {
    const { service } = setup()
    service.setMode(review.id)

    expect(service.setMode('not-installed')).toBe(false)
    for (const sketch of sketchModes) {
      expect(service.setMode(sketch.id)).toBe(false)
    }
    expect(service.activeMode.value).toBe(review)
  })

  it('lets sketch workflows own the mode and restores the selected plugin on exit', () => {
    const { service } = setup()
    service.setMode(review.id)

    for (const mode of ['onlyCancel', 'sketching', 'sketchSolve'] as const) {
      service.syncModelingMode(mode)
      expect(service.activeMode.value?.id).toBe(mode)
      expect(service.canSelectMode.value).toBe(false)
      expect(service.setMode(modeling.id)).toBe(false)
      expect(service.selectedModeId.value).toBe(review.id)
    }

    service.syncModelingMode('modeling')
    expect(service.canSelectMode.value).toBe(true)
    expect(service.activeMode.value).toBe(review)
  })

  it('blocks mode switches during transitions that retain the modeling toolbar', () => {
    const { service } = setup()
    service.syncModelingMode('modeling', false)

    expect(service.canSelectMode.value).toBe(false)
    expect(service.setMode(review.id)).toBe(false)
    expect(service.activeMode.value).toBe(modeling)

    service.syncModelingMode('modeling', true)
    expect(service.setMode(review.id)).toBe(true)
  })

  it('falls back immediately when a plugin is disabled and does not reselect it when enabled', async () => {
    const { container, service } = setup()
    const [plugin] = container.get(pluginsValueSpec)
    const toggle = container.get(plugin.service)
    service.setMode(review.id)

    await toggle.disable()
    // No active-mode reads between removal and reinstallation: cleanup must
    // follow the registry lifecycle independently of whether a view is mounted.
    await toggle.enable()

    expect(service.selectedModeId.value).toBe(modeling.id)
    expect(service.activeMode.value).toBe(modeling)
    expect(service.modes.value).toContain(review)
  })

  it('forgets a removed plugin while sketching without interrupting the sketch', async () => {
    const { container, service, modeSlot, plugin } = setup()
    service.setMode(review.id)
    service.syncModelingMode('sketchSolve')

    await container.reconfigureAsync(modeSlot, [])
    expect(service.activeMode.value?.id).toBe('sketchSolve')
    expect(service.selectedModeId.value).toBe(modeling.id)

    await container.reconfigureAsync(modeSlot, [plugin])
    service.syncModelingMode('modeling')
    expect(service.activeMode.value).toBe(modeling)
  })

  it('drops a selection if its reactive registration stops being selectable', () => {
    const reactiveMode = signal(review)
    const container = new Registry()
    registry = container
    container.configure([
      builtinModes,
      modesExtension,
      defineRegistryItem({
        provides: [provide(modesValueSpec, reactiveMode)],
      }),
    ])
    const service = container.get(modesService)
    service.setMode(review.id)

    reactiveMode.value = { ...review, selectable: false }
    expect(service.activeMode.value).toBe(modeling)
    expect(service.selectedModeId.value).toBe(modeling.id)
  })

  it('preserves selection when unrelated registry content changes', async () => {
    const { container, service, modeSlot, plugin } = setup()
    service.setMode(review.id)

    await container.reconfigureAsync(modeSlot, [
      plugin,
      defineRegistryItem({ id: 'unrelated-feature' }),
    ])

    expect(container.get(modesService).selectedModeId.value).toBe(review.id)
    expect(service.activeMode.value).toBe(review)
  })

  it('resets both the selected mode and machine override when leaving the workspace', () => {
    const { service } = setup()
    service.setMode(review.id)
    service.syncModelingMode('sketchSolve', false)

    service.reset()

    expect(service.selectedModeId.value).toBe(modeling.id)
    expect(service.activeMode.value).toBe(modeling)
    expect(service.canSelectMode.value).toBe(true)
  })

  it('prevents a disposed mode service from changing a later workspace', async () => {
    const { container, service } = setup()
    service.setMode(review.id)

    await container.configureAsync([builtinModes])
    expect(service.setMode(review.id)).toBe(false)
    service.syncModelingMode('sketchSolve')
    expect(service.selectedModeId.value).toBe(modeling.id)
    expect(service.activeMode.value).toBe(modeling)
  })

  it('resolves duplicate mode IDs using registry precedence', () => {
    const container = new Registry()
    registry = container
    const replacement = { ...review, label: 'Priority Review' }
    container.configure([
      defineRegistryItem({ provides: [provideMode(review)] }),
      defineRegistryItem({
        provides: [provideMode(replacement, 'high')],
      }),
      defineRegistryItem({
        // Direct contributions still cannot create duplicate selector entries.
        provides: [provide(modesValueSpec, { ...review })],
      }),
    ])

    expect(container.get(modesValueSpec)).toEqual([replacement])
  })
})
