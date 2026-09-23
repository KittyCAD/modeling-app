import { expect, test } from '@e2e/playwright/base-test'
import {
  type CloudProject,
  cloudProjectResponse,
  PROJECT_DIR,
  readOpfsTextFiles,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { expectCloudFeatureEnabled, setup } from '@e2e/playwright/test-utils'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import JSZip from 'jszip'

test(
  'imports a project ZIP into Personal Cloud and supports dropping another copy',
  { tag: ['@web'] },
  async ({ context, page }, testInfo) => {
    const sourceId = '29501ba6-dfa1-486f-b51d-aa9331ee441e'
    const sourceToml = [
      'title = "ZIP assembly"',
      'default_file = "design/entry.kcl"',
      '[settings.meta]',
      `id = "${sourceId}"`,
      '[settings.modeling]',
      'base_unit = "cm"',
      '[cloud."dev.zoo.dev"]',
      'project_id = "someone-elses-project"',
      '',
    ].join('\n')
    const zip = new JSZip()
      .file('export/project.toml', sourceToml)
      .file('export/main.kcl', 'unused = 1\n')
      .file('export/design/entry.kcl', 'dimension = 20mm\n')
      .file('export/assets/part.step', new Uint8Array([0, 128, 255]))
    const archive = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    const remoteProjects: CloudProject[] = []
    const remoteArchives = new Map<string, Buffer>()
    const { calls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteArchives,
      createProject: async (postData) => {
        const index = remoteProjects.length
        const project: CloudProject = {
          id: `29501ba6-dfa1-486f-b51d-aa9331ee442${index}`,
          title: index === 0 ? 'ZIP assembly' : `ZIP assembly-${index}`,
          revision: 'rev-1',
          files: {},
        }
        // Serve the newly uploaded copy on reload, including its fresh identity.
        const settingsId = postData.match(
          /\[settings\.meta\]\s*id = "([^"]+)"/
        )?.[1]
        expect(settingsId).toBeDefined()
        const storedZip = new JSZip()
          .file('main.kcl', 'unused = 1\n')
          .file('design/entry.kcl', 'dimension = 20mm\n')
          .file('assets/part.step', new Uint8Array([0, 128, 255]))
          .file(
            'project.toml',
            sourceToml
              .replace(sourceId, settingsId!)
              .replace('someone-elses-project', project.id)
              .replace('ZIP assembly', project.title)
          )
        remoteArchives.set(
          project.id,
          Buffer.from(await storedZip.generateAsync({ type: 'uint8array' }))
        )
        remoteProjects.push(project)
        return project
      },
      updateProject: ({ projectId }) => {
        const project = remoteProjects.find(({ id }) => id === projectId)
        return project
          ? { status: 200, body: cloudProjectResponse(project) }
          : undefined
      },
    })
    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG], {
      cloudSyncEnabled: true,
    })
    await expectCloudFeatureEnabled(page)
    await page.getByTestId('home-import-project').click()
    const dialog = page.getByRole('dialog', { name: 'Import project' })
    await expect(dialog.getByLabel('Library')).toContainText('Personal Cloud')
    await dialog.getByLabel('Project ZIP').setInputFiles({
      name: 'assembly.zip',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await dialog
      .getByRole('button', { name: 'Import project', exact: true })
      .click()
    await expect(page).toHaveURL(/zip-assembly%2Fdesign%2Fentry\.kcl$/)
    await expect.poll(() => calls.creates.length).toBe(1)
    expect(calls.creates[0]).toContain('assets/part.step')
    expect(calls.creates[0]).toContain('design/entry.kcl')
    expect(calls.creates[0]).not.toContain('someone-elses-project')

    const projectPath = `${PROJECT_DIR}/zip-assembly`
    const files = await readOpfsTextFiles(page, {
      settings: `${projectPath}/project.toml`,
      entry: `${projectPath}/design/entry.kcl`,
    })
    expect(files.entry).toBe('dimension = 20mm\n')
    expect(files.settings).toContain('base_unit = "cm"')
    expect(files.settings).not.toContain(sourceId)
    const readAsset = () =>
      page.evaluate(async (path) => {
        const data = await window.fsZds.readFile(path)
        return Array.from(data)
      }, `${projectPath}/assets/part.step`)
    expect(await readAsset()).toEqual([0, 128, 255])
    await page.reload()
    await expect(page.locator('.cm-content')).toContainText('dimension = 20mm')
    expect(await readAsset()).toEqual([0, 128, 255])

    await page.getByTestId('app-logo').click()
    await expect(page.getByTestId('home-import-project')).toBeVisible()
    const dropArchive = async () => {
      const dataTransfer = await page.evaluateHandle((bytes) => {
        const transfer = new DataTransfer()
        transfer.items.add(
          new File([new Uint8Array(bytes)], 'assembly.zip', {
            type: 'application/zip',
          })
        )
        return transfer
      }, Array.from(archive))
      await page
        .getByTestId('home-header')
        .dispatchEvent('drop', { dataTransfer })
      await dataTransfer.dispose()
    }
    await dropArchive()
    await expect(
      dialog.getByText('assembly.zip', { exact: true })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    expect(calls.creates).toHaveLength(1)

    await dropArchive()
    await dialog
      .getByRole('button', { name: 'Import project', exact: true })
      .click()
    await expect(page).toHaveURL(/zip-assembly-1%2Fdesign%2Fentry\.kcl$/)
    await expect.poll(() => calls.creates.length).toBe(2)
    const copies = await readOpfsTextFiles(page, {
      original: `${projectPath}/project.toml`,
      copy: `${PROJECT_DIR}/zip-assembly-1/project.toml`,
    })
    expect(copies.original).toContain('title = "ZIP assembly"')
    expect(copies.copy).toContain('title = "ZIP assembly-1"')
    expect(copies.original).not.toBe(copies.copy)
  }
)
