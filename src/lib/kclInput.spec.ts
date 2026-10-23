import type { WebSocketResponse } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import { createKclManagerTestHarness } from '@src/lang/testHelpers/kclManagerTestHarness'
import {
  getCalculatedKclExpressionValue,
  stringToKclExpression,
} from '@src/lib/kclHelpers'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import * as UserFeatures from '@src/machines/userFeaturesMachine'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise the real Wasm executor; only the engine socket is mocked.
function mockEngine(kclManager: KclManager) {
  kclManager.engineCommandManager.started = true
  kclManager.engineCommandManager.connection = {
    connected: true,
    websocket: { readyState: WebSocket.OPEN },
  } as unknown as typeof kclManager.engineCommandManager.connection
  return vi
    .spyOn(kclManager.engineCommandManager, 'sendCommand')
    .mockImplementation(
      async (id, { command }): Promise<[WebSocketResponse]> => {
        if (command.type === 'modeling_cmd_batch_req') {
          return [
            {
              success: true,
              request_id: id,
              resp: {
                type: 'modeling_batch',
                data: {
                  responses: Object.fromEntries(
                    command.requests.map(({ cmd_id }) => [
                      cmd_id,
                      { success: true, response: { type: 'empty' } },
                    ])
                  ),
                },
              },
            },
          ]
        }
        return [
          {
            success: true,
            request_id: id,
            resp: {
              type: 'modeling',
              data: { modeling_response: { type: 'empty' } },
            },
          },
        ]
      }
    )
}

beforeEach(() => {
  vi.spyOn(UserFeatures, 'waitForUserFeaturesSettled').mockResolvedValue()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllTimers()
  localStorage.clear()
})

describe('KCL inputs in the model context', () => {
  it.each([undefined, '1.0', '2.0', '"3.0-preview"'])(
    'uses model variables and units for KCL %s',
    async (version) => {
      const code = `@settings(${version ? `kclVersion = ${version}, ` : ''}defaultLengthUnit = in)
height = 2mm
innerRadius = 1mm`
      const { kclManager } = createKclManagerTestHarness(code)
      const send = mockEngine(kclManager)
      await kclManager.executeCode()
      expect(kclManager.hasErrors()).toBe(false)
      send.mockClear()

      // Numeric defaults must not discard model variables before the user types one.
      for (const [expression, expected] of [
        ['5', '5'],
        ['height', '2mm'],
        ['innerRadius * 2', '2mm'],
        ['1in + 1', '2in'],
        ['missingVariable', 'NAN'],
        ['height', '2mm'],
      ]) {
        expect(
          await getCalculatedKclExpressionValue(
            expression,
            kclManager.rustContext
          )
        ).toHaveProperty('valueAsString', expected)
      }
      expect(
        await stringToKclExpression(
          '[height, innerRadius]',
          kclManager.rustContext,
          { allowArrays: true }
        )
      ).toMatchObject({
        valueText: '[height, innerRadius]',
        valueCalculated: '[2mm, 1mm]',
      })
      expect(send).not.toHaveBeenCalled()
    }
  )

  it('uses the settings and variables restored by a sketch checkpoint', async () => {
    const { kclManager } = createKclManagerTestHarness()
    mockEngine(kclManager)
    const checkpoints: number[] = []
    for (const code of [
      '@settings(kclVersion = 2.0, defaultLengthUnit = in)\nx = 1in',
      '@settings(kclVersion = "3.0-preview", defaultLengthUnit = mm)\nx = 2mm',
    ]) {
      const ast = await kclManager.safeParse(code)
      if (!ast) throw new Error('Expected a valid program')
      const result = await kclManager.rustContext.hackSetProgram(
        ast,
        jsAppSettings(kclManager.systemDeps.settings)
      )
      if (result.type !== 'Success' || result.checkpointId == null) {
        throw new Error('Expected a sketch checkpoint')
      }
      checkpoints.push(result.checkpointId)
    }

    for (const [index, expected] of ['2in', '3mm'].entries()) {
      await kclManager.rustContext.restoreSketchCheckpoint(checkpoints[index])
      expect(
        await getCalculatedKclExpressionValue('x + 1', kclManager.rustContext)
      ).toHaveProperty('valueAsString', expected)
    }
  })

  it('recovers after model execution fails across a version change', async () => {
    const { kclManager } = createKclManagerTestHarness(
      '@settings(kclVersion = 2.0)\nx = 1'
    )
    mockEngine(kclManager)
    await kclManager.executeCode()
    expect(kclManager.hasErrors()).toBe(false)
    await kclManager.executeCode(
      '@settings(kclVersion = "3.0-preview")\nx = missingVariable'
    )
    expect(kclManager.hasErrors()).toBe(true)
    expect(
      await getCalculatedKclExpressionValue('x', kclManager.rustContext)
    ).toHaveProperty('valueAsString', 'NAN')

    await kclManager.executeCode('@settings(kclVersion = 2.0)\nx = 1')
    expect(kclManager.hasErrors()).toBe(false)
    expect(
      await getCalculatedKclExpressionValue('x', kclManager.rustContext)
    ).toHaveProperty('valueAsString', '1')
  })
})
