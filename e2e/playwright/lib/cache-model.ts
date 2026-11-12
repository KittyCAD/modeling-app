import { expect } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import { isArray } from '@src/lib/utils'

export const cacheModelCode = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
radiusValue = 10mm
height = 5mm
profile = sketch(on = XY) {
  perimeter = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([perimeter.center, ORIGIN])
  radius(perimeter) == radiusValue
  horizontal([perimeter.center, perimeter.start])
}
body = extrude(region(segments = [profile.perimeter]), length = height)
`

export async function waitForExecutedModel(page: Page, code: string) {
  await expect
    .poll(
      () =>
        page.evaluate((code) => {
          const editor = window.app.project?.executingEditor.value
          return Boolean(
            editor &&
              editor.code.trim() === code.trim() &&
              editor.lastSuccessfulCode.trim() === code.trim() &&
              !editor.hasErrors() &&
              !editor.isExecutingSignal.value &&
              editor.artifactGraph.size > 0 &&
              editor.engineCommandManager.isReady &&
              Object.keys(editor.engineCommandManager.pendingCommands)
                .length === 0
          )
        }, code),
      { timeout: 30_000 }
    )
    .toBe(true)
}

export async function cacheSceneReceipt(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    const body = editor.variables.body
    const settings = editor.rustContext.settingsActor.getSnapshot().context
    const response = await editor.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: crypto.randomUUID(),
      cmd: {
        type: 'scene_get_entity_ids',
        filter: ['solid3d'],
        skip: 0,
        take: 100,
      },
    })
    const logs = editor.engineCommandManager.commandLogs
    return {
      response,
      path: editor.path,
      code: editor.code,
      lastSuccessfulCode: editor.lastSuccessfulCode,
      bodyId: body?.type === 'Solid' ? body.value.id : null,
      artifacts: [...editor.artifactGraph.keys()].sort(),
      defaultPlanes: editor.rustContext.defaultPlanes,
      sessionId: editor.engineCommandManager.engineSessionId,
      apiCallId: editor.engineCommandManager.apiCallId,
      engineSceneGeneration: editor.execState.engineSceneGeneration,
      publishedGeneration: editor.engineSceneGenerationSignal.peek(),
      scalar: editor.variables.x,
      hasErrors: editor.hasErrors(),
      isExecuting: editor.isExecutingSignal.value,
      preferences: {
        enableSsao: settings.modeling.enableSSAO.current,
        fixedSizeGrid: settings.modeling.fixedSizeGrid.current,
        backfaceColor: settings.modeling.backfaceColor.current,
        defaultUnit: settings.modeling.defaultUnit.current,
      },
      fileUnit: editor.fileSettings.defaultLengthUnit,
      executions: logs.filter((log) => log.type === 'execution-done').length,
      commands: logs.flatMap((log) => {
        // Rust sends directly through sendCommand. Include its acknowledged
        // commands even when there is no corresponding send-scene entry.
        if (log.type === 'receive-reliable')
          return log.cmd_type ? [log.cmd_type] : []
        if (log.type !== 'send-scene' && log.type !== 'send-modeling') return []
        if (log.data.type === 'modeling_cmd_req') return [log.data.cmd.type]
        if (log.data.type === 'modeling_cmd_batch_req')
          return log.data.requests.map((request) => request.cmd.type)
        return []
      }),
    }
  })
  const { response, ...model } = snapshot
  const reply = isArray(response) ? response[0] : response
  if (
    !reply ||
    !reply.success ||
    !('resp' in reply) ||
    reply.resp.type !== 'modeling' ||
    reply.resp.data.modeling_response.type !== 'scene_get_entity_ids'
  )
    throw new Error('The real engine must return its live solid IDs')
  return {
    ...model,
    engineBodyIds: reply.resp.data.modeling_response.data.entity_ids
      .flat()
      .sort(),
  }
}

export async function cacheSceneVolume(page: Page) {
  const response = await page.evaluate(async () => {
    const editor = window.app.project?.executingEditor.value
    if (!editor) throw new Error('No executing editor')
    return editor.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: crypto.randomUUID(),
      cmd: { type: 'volume', entity_ids: [], output_unit: 'mm3' },
    })
  })
  const reply = isArray(response) ? response[0] : response
  if (
    !reply ||
    !reply.success ||
    !('resp' in reply) ||
    reply.resp.type !== 'modeling' ||
    reply.resp.data.modeling_response.type !== 'volume'
  )
    throw new Error('The real engine must return its live volume')
  return reply.resp.data.modeling_response.data.volume
}
