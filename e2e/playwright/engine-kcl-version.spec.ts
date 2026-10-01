import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

const kcl2 = `@settings(kclVersion = 2.0, defaultLengthUnit = mm)
profile = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [10, 0])
  right = line(start = [10, 0], end = [10, 10])
  top = line(start = [10, 10], end = [0, 10])
  left = line(start = [0, 10], end = [0, 0])
}
region001 = region(point = [5, 5], sketch = profile)
body001 = extrude(region001, length = 5)`
const kcl3 = kcl2.replace('2.0', '"3.0-preview"')

test(
  'synchronizes the engine KCL version on connect, file switches, and edits',
  { tag: ['@web', '@desktop'] },
  async ({ page, folderSetupFn, fs, homePage, toolbar, editor, scene }) => {
    await folderSetupFn(async (dir) => {
      const project = await fs.join(dir, 'engine-kcl-version')
      await fs.mkdir(project, { recursive: true })
      await fs.writeFile(
        await fs.join(project, 'main.kcl'),
        new TextEncoder().encode(kcl2)
      )
      await fs.writeFile(
        await fs.join(project, 'preview.kcl'),
        new TextEncoder().encode(kcl3)
      )
    })

    const socketUrls: string[] = []
    const versions: string[] = []
    page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (!url.searchParams.has('video_res_width')) return
      socketUrls.push(socket.url())
      socket.on('framesent', ({ payload }) => {
        const command: EngineCommand = JSON.parse(payload.toString())
        const commands =
          command.type === 'modeling_cmd_batch_req'
            ? command.requests.map(({ cmd }) => cmd)
            : command.type === 'modeling_cmd_req'
              ? [command.cmd]
              : []
        for (const cmd of commands) {
          if (cmd.type === 'set_kcl_version') versions.push(cmd.kcl_version)
        }
      })
    })

    await homePage.openProject('engine-kcl-version')
    await scene.settled()
    expect(socketUrls).toHaveLength(1)
    expect(new URL(socketUrls[0]).searchParams.get('kcl_version')).toBe('2.0')
    await expect.poll(() => versions.at(-1)).toBe('2.0')
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    versions.length = 0

    await (await getUtils(page)).openFilePanel()
    await scene.waitForExecutionDoneAfter(() => toolbar.openFile('preview.kcl'))
    expect(versions).toEqual(['3.0-preview'])
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCodeByTyping('"3.0-preview"', '2.0')
    )
    expect(versions).toEqual(['3.0-preview', '2.0'])
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

    expect(socketUrls).toHaveLength(1)
  }
)
