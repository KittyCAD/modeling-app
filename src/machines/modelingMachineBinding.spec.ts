import { createActor } from 'xstate'
import { expect, it, vi } from 'vitest'
vi.mock('@src/lib/boot', () => ({
  app: {},
  useApp: vi.fn(),
  useSingletons: vi.fn(),
}))
import { modelingMachine } from '@src/machines/modelingMachine'
import {
  bindModelingMachine,
  type ModelingMachineStateHost,
} from '@src/machines/modelingMachineBinding'
import { buildModelingMachineInput } from '@src/unitTestUtils'

// Scene startup is outside these binding tests; transitions and context creation use the real machine.
const machine = modelingMachine.provide({
  actions: {
    'set modeling idle double-click callback': () => {},
    'restore modeling camera controls': () => {},
    'reset client scene mouse handlers': () => {},
    'hide default planes': () => {},
  },
})
async function start() {
  return createActor(machine, {
    input: await buildModelingMachineInput(),
  }).start()
}
function host(): ModelingMachineStateHost {
  return {
    modelingSend: () => {},
    modelingState: null,
    selectionRanges: { graphSelections: [], otherSelections: [] },
  }
}

it('allocates mutable selection, visibility, overlays and native sketch defaults separately for each actor', async () => {
  const first = await start(),
    second = await start()
  try {
    const a = first.getSnapshot().context,
      b = second.getSnapshot().context
    a.selectionRanges.otherSelections.push('x-axis')
    a.savedDefaultPlaneVisibility.xy = false
    a.segmentHoverMap.segment = 1
    a.initialSceneGraphDelta.new_graph.settings.show_grid = true
    expect(b.selectionRanges.otherSelections).toEqual([])
    expect(b.savedDefaultPlaneVisibility.xy).toBe(true)
    expect(b.segmentHoverMap).toEqual({})
    expect(b.initialSceneGraphDelta.new_graph.settings.show_grid).toBe(false)
    const third = await start()
    expect(third.getSnapshot().context.selectionRanges.otherSelections).toEqual(
      []
    )
    third.stop()
  } finally {
    first.stop()
    second.stop()
  }
})

it('publishes to the supplied owner and disconnects without stopping a borrowed actor', async () => {
  const first = await start(),
    second = await start()
  const a = host(),
    b = host()
  const detach = bindModelingMachine(first, a),
    detachOther = bindModelingMachine(second, b)
  try {
    a.modelingSend({
      type: 'show non-visual constraints changed',
      data: { value: true },
    })
    expect(a.modelingState?.context.showNonVisualConstraints).toBe(true)
    expect(b.modelingState?.context.showNonVisualConstraints).toBe(false)
    expect(a.selectionRanges).toBe(first.getSnapshot().context.selectionRanges)
    detach()
    expect(a.modelingState).toBeNull()
    expect(a.selectionRanges).toEqual({
      graphSelections: [],
      otherSelections: [],
    })
    expect(first.getSnapshot().status).toBe('active')
    first.send({
      type: 'show non-visual constraints changed',
      data: { value: false },
    })
    expect(a.modelingState).toBeNull()
    b.modelingSend({
      type: 'show non-visual constraints changed',
      data: { value: true },
    })
    expect(b.modelingState?.context.showNonVisualConstraints).toBe(true)
  } finally {
    detach()
    detachOther()
    first.stop()
    second.stop()
  }
})

it('does not let an old binding cleanup disconnect its replacement and releases state when that actor stops', async () => {
  const first = await start(),
    second = await start(),
    target = host()
  const old = bindModelingMachine(first, target)
  const current = bindModelingMachine(second, target)
  try {
    old()
    target.modelingSend({
      type: 'show non-visual constraints changed',
      data: { value: true },
    })
    expect(second.getSnapshot().context.showNonVisualConstraints).toBe(true)
    expect(first.getSnapshot().context.showNonVisualConstraints).toBe(false)
    first.stop()
    expect(target.modelingState).toBe(second.getSnapshot())
    second.stop()
    expect(target.modelingState).toBeNull()
  } finally {
    old()
    current()
    first.stop()
    second.stop()
  }
})
