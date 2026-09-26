import { expect, test } from '@e2e/playwright/zoo-test'
import { getUtils } from '@e2e/playwright/test-utils'
import type { EngineCommand } from '@src/lang/std/artifactGraph'

const kcl2 = `@settings(kclVersion = 2.0)
profile = sketch(on = XY) {
  segment = line(start = [0mm, 0mm], end = [10mm, 0mm])
}`
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
        if (
          command.type === 'modeling_cmd_req' &&
          command.cmd.type === 'set_kcl_version'
        ) {
          versions.push(command.cmd.kcl_version)
        }
      })
    })

    await homePage.openProject('engine-kcl-version')
    await scene.settled()
    // Startup may retry the connection; edits must preserve the ready session.
    const initialSocketCount = socketUrls.length
    expect(initialSocketCount).toBeGreaterThan(0)
    expect(
      new URL(socketUrls[initialSocketCount - 1]).searchParams.get(
        'kcl_version'
      )
    ).toBe('2.0')
    expect(versions).toEqual([])

    await (await getUtils(page)).openFilePanel()
    await toolbar.openFile('preview.kcl')
    await expect.poll(() => versions).toEqual(['3.0-preview'])
    await scene.settled()

    await editor.replaceCodeByTyping('"3.0-preview"', '2.0')
    await expect.poll(() => versions).toEqual(['3.0-preview', '2.0'])
    await scene.settled()

    expect(socketUrls).toHaveLength(initialSocketCount)
  }
)
