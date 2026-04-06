import { afterEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import { createActor } from 'xstate'

import { modelingMachine } from '@src/machines/modelingMachine'
import { generateModelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

/** Engine-less unit tests of modelingMachine. For engine-powered integration tests, see modelingMachine.spec.ts */

const waitForCondition = async (
  condition: () => boolean,
  timeout = 1_000,
  interval = 25
) => {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }

  expect(condition()).toBe(true)
}

const invalidCode = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  line1 = line(start = [var -4.23mm, var 0.9mm], end = [var 2.98mm, var 3.19mm])
  line2 = line(start = [var 2.98mm, var 3.19mm], end = [var 3.57mm, var -4.02mm])
  coincident([line1.end line2.start])
}`

const toastErrorSpy = vi
  .spyOn(toast, 'error')
  .mockImplementation(() => '' as any)

afterEach(() => {
  toastErrorSpy.mockClear()
  vi.restoreAllMocks()
})

describe('modelingMachine sketch entry', () => {
  it('keeps invalid code intact when sketch creation is attempted with parse errors', async () => {
    const {
      instance,
      kclManager,
      rustContext,
      engineCommandManager,
      commandBarActor,
      machineManager,
    } = await buildTheWorldAndNoEngineConnection()

    kclManager.updateCodeEditor(invalidCode)
    const parseResult = await kclManager.safeParse(invalidCode)

    expect(parseResult).toBeNull()
    expect(kclManager.hasParseErrors()).toBe(true)

    const newSketchSpy = vi.spyOn(rustContext, 'newSketch')

    const context = generateModelingMachineDefaultContext({
      kclManager,
      rustContext,
      wasmInstance: instance,
      engineCommandManager,
      commandBarActor,
      machineManager,
    })
    context.store.useSketchSolveMode = { current: true } as any
    context.store.defaultUnit = { current: 'mm' } as any
    context.projectRef = { current: {} as any }

    const actor = createActor(modelingMachine, { input: context }).start()

    actor.send({ type: 'Enter sketch' })
    actor.send({
      type: 'Select sketch solve plane',
      data: 'test-plane-id',
    })

    await waitForCondition(() => toastErrorSpy.mock.calls.length > 0)
    await waitForCondition(() => actor.getSnapshot().value === 'Sketch no face')

    expect(newSketchSpy).not.toHaveBeenCalled()
    expect(kclManager.code).toBe(invalidCode)
    expect(actor.getSnapshot().value).toBe('Sketch no face')
    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Unable to enter sketch while KCL has parse errors'
    )
  })
})
