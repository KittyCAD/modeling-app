import { randomUUID } from 'node:crypto'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { expect, test as appTest } from '@e2e/playwright/zoo-test'
import { test as browserTest } from '@e2e/playwright/base-test'
import { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import {
  setup,
  mockClientErrorReports,
  doAndWaitForImageDiff,
} from '@e2e/playwright/test-utils'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import { projectToml } from '@e2e/playwright/lib/cloudProjectTestUtils'
import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import { FsFixture } from '@e2e/playwright/fixtures/fsFixture'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import {
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// Browser-local storage is OPFS; desktop-local storage uses Electron's filesystem.
const test = process.env.TARGET === 'web' ? browserTest : appTest

const blankCode = '@settings(kclVersion = 3.0)\n'
const solidCode = `${blankCode}profile = sketch(on = XY) {
  line(start = [0mm, 0mm], end = [20mm, 0mm])
  line(start = [20mm, 0mm], end = [20mm, 20mm])
  line(start = [20mm, 20mm], end = [0mm, 20mm])
  line(start = [0mm, 20mm], end = [0mm, 0mm])
}
section = region(point = [10mm, 10mm], sketch = profile)
body = extrude(section, length = 10mm)
`
type StorageKind = 'local' | 'cloud'

async function prepareStorage(
  kind: StorageKind,
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  {
    modeling = false,
    creationGate,
  }: {
    modeling?: boolean
    creationGate?: Promise<void>
  } = {}
) {
  await mockClientErrorReports(context)
  // Intercept Projects even for local cases: unexpected cloud mutations are observable.
  const remote = await mockCloudStorage(context, {
    startEmpty: true,
    mockModeling: !modeling,
    beforeCreate:
      kind === 'cloud' && creationGate ? () => creationGate : undefined,
  })
  if (process.env.TARGET === 'web') await setup(context, page, testInfo)
  await page.goto('/home')
  const home = new HomePageFixture(page)
  await expect(page.getByTestId('home-header')).toBeVisible()
  const fs = FsFixture(page)
  const localDirectory =
    process.env.TARGET === 'web'
      ? '/documents/project-workflows'
      : testInfo.outputPath('projects')
  await fs.mkdir(localDirectory, { recursive: true })
  const library: ProjectLibrarySetting =
    kind === 'cloud'
      ? getDefaultCloudProjectLibrarySetting()
      : { title: 'Local Projects', type: 'directory', path: localDirectory }
  const selectLibrary = async () => {
    await page.evaluate((library) => {
      window.app.settings.actor.send({
        type: 'set.app.libraries',
        data: { level: 'user', value: [library] },
      })
    }, library)
    await expect
      .poll(() =>
        page.evaluate(() => window.app.settings.actor.getSnapshot().value)
      )
      .toBe('idle')
  }
  const enterLibrary = async () => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(
      /^(Project Libraries|Local Projects|Personal Cloud|Projects)$/
    )
    if ((await heading.innerText()) === 'Project Libraries') {
      await page
        .getByRole('link', {
          name: `Open ${library.title} library`,
          exact: true,
        })
        .click()
    }
    await home.projectsLoaded()
  }
  const goHome = async () => {
    await page.getByTestId('app-logo').click()
    await enterLibrary()
  }
  await selectLibrary()
  await enterLibrary()
  const seed = async (
    name: string,
    code: string,
    extraFiles: Record<string, string> = {}
  ) => {
    const files = {
      'main.kcl': code,
      'project.toml': projectToml(name),
      ...extraFiles,
    }
    if (kind === 'cloud') {
      const id = randomUUID()
      remote.projects.push({ id, title: name, revision: '1', files })
      return fs.resolve('/__zoo_cloud__', id)
    }
    const root = await fs.join(
      localDirectory,
      getProjectDirectoryNameFromTitle(name, 'untitled')
    )
    for (const [relativePath, contents] of Object.entries(files)) {
      const path = await fs.join(root, relativePath)
      await fs.mkdir(await fs.dirname(path), { recursive: true })
      await fs.writeFile(path, new TextEncoder().encode(contents))
    }
    await expect(fs.stat(root)).resolves.toBeDefined()
    await expect(
      fs.readFile(await fs.join(root, 'main.kcl'), 'utf8')
    ).resolves.toBe(code)
    return root
  }
  const read = async (root: string, relativePath = 'main.kcl') => {
    if (kind === 'cloud') {
      return remote.projects.find((project) => root.endsWith(project.id))
        ?.files[relativePath]
    }
    return new TextDecoder().decode(
      await fs.readFile(await fs.join(root, relativePath))
    )
  }
  const replace = async (root: string, code: string) => {
    if (kind === 'cloud') {
      const project = remote.projects.find((project) =>
        root.endsWith(project.id)
      )
      if (!project) throw new Error('Missing remote project')
      project.files['main.kcl'] = code
      project.revision = String(Number(project.revision) + 1)
    } else {
      await fs.writeFile(
        await fs.join(root, 'main.kcl'),
        new TextEncoder().encode(code)
      )
    }
  }
  const refresh = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.app?.settings))
    await selectLibrary()
  }
  const assertStorage = async (root: string) => {
    if (kind === 'cloud') {
      await expect(fs.stat(root)).rejects.toBeDefined()
    } else {
      await expect(
        fs.stat(await fs.join(root, 'main.kcl'))
      ).resolves.toBeDefined()
      expect(remote.creates).toHaveLength(0)
      expect(remote.uploads).toHaveLength(0)
    }
  }
  return {
    remote,
    fs,
    home,
    goHome,
    seed,
    read,
    replace,
    refresh,
    assertStorage,
  }
}

async function createThroughHome(
  page: Page,
  home: HomePageFixture,
  title?: string
) {
  await home.projectsLoaded()
  await home.projectButtonNew.click()
  if (title !== undefined) await home.projectTextName.fill(title)
  await home.projectButtonContinue.click()
  await expect(page).toHaveURL(/\/file\/.*main\.kcl$/)
  await expect(page.locator('.cm-content').first()).toBeVisible()
  const root = await page.evaluate(() => window.app.project?.path)
  if (!root) throw new Error('Created project did not open')
  return root
}

async function editThroughUI(page: Page, code: string) {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(code)
}

async function expectEditor(page: Page, code: string) {
  await expect(page.locator('.cm-content').first()).toHaveText(code, {
    useInnerText: true,
  })
}

// Both implementations execute the same actions and UI assertions. Naming policy
// and persistence inspection are the explicit implementation-specific boundaries.
for (const kind of ['local', 'cloud'] as const) {
  test.describe(
    `${kind} project workflow contract`,
    { tag: ['@web', '@desktop'] },
    () => {
      test('creates a blank project, edits, saves, reloads and reopens it', async ({
        page,
        context,
      }, testInfo) => {
        const creation = Promise.withResolvers<undefined>()
        const storage = await prepareStorage(kind, page, context, testInfo, {
          creationGate: creation.promise,
        })
        await expect(storage.home.projectCard).toHaveCount(0)
        const homeURL = page.url()
        const title = 'Blank project'
        await storage.home.projectButtonNew.click()
        await storage.home.projectTextName.fill(title)
        await storage.home.projectButtonContinue.click()
        if (kind === 'cloud') {
          const clockStart = new Date()
          await page.clock.install({ time: clockStart })
          await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
          try {
            await expect.poll(() => storage.remote.creates.length).toBe(1)
            await page.clock.runFor(7_000)
            await expect(page).toHaveURL(homeURL)
            expect(storage.remote.creates).toHaveLength(1)
            expect(storage.remote.uploads).toHaveLength(0)
          } finally {
            creation.resolve(undefined)
            await page.clock.resume()
          }
        }
        await expect(page).toHaveURL(/\/file\/.*main\.kcl$/)
        await expect(
          page.getByRole('button', { name: `${title} / main.kcl caret down` })
        ).toBeVisible()
        const root = await page.evaluate(() => window.app.project!.path)
        await expect
          .poll(() => storage.read(root))
          .toMatch(/^@settings\([^)]*\)\s*$/)
        await expectEditor(page, (await storage.read(root))!)
        await expect(
          page.evaluate(
            (root) => window.app.fileOperations.readDirectory(root),
            root
          )
        ).resolves.toEqual(expect.arrayContaining(['main.kcl', 'project.toml']))
        if (kind === 'cloud') {
          expect(storage.remote.creates[0].title).toBe(title)
          expect(Object.keys(storage.remote.creates[0].files).sort()).toEqual([
            'main.kcl',
            'project.toml',
          ])
        }
        const code = `${blankCode}// Saved from a new project\nwidth = 42\n`
        await editThroughUI(page, code)
        await expect.poll(() => storage.read(root)).toBe(code)
        await expect
          .poll(() => page.evaluate(() => window.app.fileOperations.pending()))
          .toBe(0)
        if (kind === 'cloud') expect(storage.remote.uploads).toContain('1')
        await storage.refresh()
        await expectEditor(page, code)
        await storage.goHome()
        await expect(
          storage.home.projectCard.filter({ hasText: title })
        ).toHaveCount(1)
        await storage.home.openProject(title)
        await expectEditor(page, code)
        expect(storage.remote.creates).toHaveLength(kind === 'cloud' ? 1 : 0)
        await storage.assertStorage(root)
      })

      test('keeps repeated and differently cased project titles distinct without overwriting earlier projects', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        // Cloud identity is the project ID; the API accepts duplicate display titles.
        // Local identity uses a case-insensitive unique directory and title suffix.
        const requested = ['Test', 'Test', 'test']
        const expected =
          kind === 'local' ? ['Test', 'Test-1', 'test-2'] : requested
        const roots: string[] = []
        for (let index = 0; index < requested.length; index++) {
          const root = await createThroughHome(
            page,
            storage.home,
            requested[index]
          )
          roots.push(root)
          await expect(
            page.getByRole('button', {
              name: `${expected[index]} / main.kcl caret down`,
            })
          ).toBeVisible()
          const code = `${blankCode}// Project ${index}\n`
          await editThroughUI(page, code)
          await expect.poll(() => storage.read(root)).toBe(code)
          await storage.goHome()
          await expect(storage.home.projectCard).toHaveCount(index + 1)
        }
        expect(new Set(roots).size).toBe(3)
        await expect
          .poll(async () =>
            (await storage.home.projectCardTitle.allTextContents()).sort()
          )
          .toEqual([...expected].sort())
        for (let index = 0; index < roots.length; index++) {
          expect(await storage.read(roots[index])).toBe(
            `${blankCode}// Project ${index}\n`
          )
          await storage.assertStorage(roots[index])
        }
      })

      test('creates twelve projects using the default title and keeps every project accessible', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo)
        const roots = new Set<string>()
        for (let index = 0; index < 12; index++) {
          roots.add(await createThroughHome(page, storage.home))
          await storage.goHome()
          await expect(storage.home.projectCard).toHaveCount(index + 1)
        }
        const titles = Array.from({ length: 12 }, (_, index) =>
          kind === 'local' && index > 0 ? `untitled-${index}` : 'untitled'
        )
        await expect
          .poll(async () =>
            (await storage.home.projectCardTitle.allTextContents()).sort()
          )
          .toEqual(titles.sort())
        expect(roots.size).toBe(12)
        for (const root of roots) await storage.assertStorage(root)
      })

      for (const next of ['broken', 'empty'] as const) {
        test(`opens and renders a project, loads external changes through direct URLs and reload, then clears the scene when switching projects (${next})`, async ({
          page,
          context,
        }, testInfo) => {
          test.setTimeout(180_000)
          const storage = await prepareStorage(kind, page, context, testInfo, {
            modeling: true,
          })
          const scene = new SceneFixture(page)
          const firstRoot = await storage.seed('Rendered project', solidCode)
          const nextCode =
            next === 'broken'
              ? `${blankCode}body = extrude(missingProfile, length = 10)\n`
              : blankCode
          await storage.seed('Next project', nextCode)
          await storage.refresh()
          const download = Promise.withResolvers<undefined>()
          let downloadStarted = false
          if (kind === 'cloud') {
            await context.route(
              '**/user/projects/*/download?format=zip',
              async (route) => {
                downloadStarted = true
                await download.promise
                await route.fallback()
              }
            )
          }
          try {
            await expect.poll(() => storage.read(firstRoot)).toBe(solidCode)
            await storage.home.openProject('Rendered project')
            if (kind === 'cloud') {
              await expect.poll(() => downloadStarted).toBe(true)
              const clockStart = new Date()
              await page.clock.install({ time: clockStart })
              await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
              await page.clock.runFor(7_000)
              expect(storage.remote.uploads).toHaveLength(0)
              expect(
                await page.evaluate(() => window.app.singletons.kclManager.code)
              ).not.toContain('body = extrude(section')
            }
          } finally {
            download.resolve(undefined)
            if (kind === 'cloud') {
              await page.clock.resume()
              await context.unroute('**/user/projects/*/download?format=zip')
            }
          }
          await scene.settled()
          await expectEditor(page, solidCode)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await storage.replace(
            firstRoot,
            `${solidCode}// Direct project load\n`
          )
          const main = await storage.fs.join(firstRoot, 'main.kcl')
          await page.goto(`/file/${encodeURIComponent(main)}`)
          await expectEditor(page, `${solidCode}// Direct project load\n`)
          await expect
            .poll(() =>
              page.evaluate(() => window.app.fileOperations.pending())
            )
            .toBe(0)
          const uploads = storage.remote.uploads.length
          await page.evaluate(() =>
            window.app.settings.actor.send({
              type: 'set.app.theme',
              data: { level: 'user', value: 'dark' },
            })
          )
          await expect
            .poll(() =>
              page.evaluate(() => window.app.settings.actor.getSnapshot().value)
            )
            .toBe('idle')
          expect(storage.remote.uploads).toHaveLength(uploads)
          await storage.replace(
            firstRoot,
            `${solidCode}// Changed externally\n`
          )
          await storage.refresh()
          await expectEditor(page, `${solidCode}// Changed externally\n`)
          await scene.settled()
          expect(
            await doAndWaitForImageDiff(
              scene.streamWrapper,
              async () => {
                await storage.goHome()
                await storage.home.openProject('Next project')
                await scene.settled({ expectError: next === 'broken' })
                await expectEditor(page, nextCode)
                if (next === 'broken') {
                  const diagnostic = page
                    .locator('.cm-lint-marker-error')
                    .first()
                  await expect(diagnostic).toBeVisible()
                  await diagnostic.hover()
                  await expect(
                    page.locator('.cm-tooltip-lint .cm-diagnosticText').first()
                  ).toContainText('missingProfile')
                } else {
                  await expect(
                    page.locator('.cm-lint-marker-error')
                  ).toHaveCount(0)
                }
              },
              500
            )
          ).toBe(true)
          await storage.assertStorage(firstRoot)
        })
      }

      test('switches files while reads, saves and modeling are pending and preserves the outgoing edit', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seed(
          'Switching project',
          `${blankCode}// Original buffer\n`,
          { 'other.kcl': `${blankCode}// Target buffer\n` }
        )
        await storage.refresh()
        await expect
          .poll(() => storage.read(root))
          .toBe(`${blankCode}// Original buffer\n`)
        await storage.home.openProject('Switching project')
        await expectEditor(page, `${blankCode}// Original buffer\n`)
        await page.evaluate(
          (ids) => {
            for (const id of ids) window.app.layout.openPane(id)
          },
          [DefaultLayoutPaneID.Code, DefaultLayoutPaneID.Files]
        )
        const originalProject = await page.evaluateHandle(
          () => window.app.project
        )
        const save = Promise.withResolvers<undefined>()
        let cloudSaveStarted = false
        if (kind === 'cloud') {
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && !cloudSaveStarted) {
              cloudSaveStarted = true
              await save.promise
            }
            await route.fallback()
          })
        }
        const gate = await page.evaluateHandle((holdSave) => {
          const file = window.app.project!.files.find((file) =>
            file.path.endsWith('other.kcl')
          )!
          const read = file.read.bind(file)
          const source = window.app.project!.files.find((file) =>
            file.path.endsWith('main.kcl')
          )!
          const io = window.app.singletons.kclManager.textFileIO
          const write = io.write.bind(io)
          const saving = Promise.withResolvers<undefined>()
          let saveStarted = false
          if (holdSave)
            Object.assign(io, {
              write: async (path: string, contents: string) => {
                if (path === source.path) {
                  saveStarted = true
                  await saving.promise
                }
                return write(path, contents)
              },
            })
          const rust = window.app.rustContext
          const open = rust.sendOpenProject.bind(rust)
          const update = rust.sendUpdateFile.bind(rust)
          const sourceId = window.app.singletons.kclManager.id
          let ready = false
          let updatesBeforeReady = 0
          rust.sendUpdateFile = async (...args) => {
            if (!ready && args[0] !== sourceId) updatesBeforeReady += 1
            return update(...args)
          }
          const buffer = Promise.withResolvers<undefined>()
          const modeling = Promise.withResolvers<undefined>()
          file.read = async () => {
            await buffer.promise
            return read()
          }
          rust.sendOpenProject = async (...args) => {
            await modeling.promise
            return open(...args)
          }
          return {
            saveStarted: () => saveStarted,
            releaseBuffer: () => {
              file.read = read
              buffer.resolve(undefined)
            },
            release: () => {
              file.read = read
              Object.assign(io, { write })
              saving.resolve(undefined)
              rust.sendOpenProject = open
              rust.sendUpdateFile = update
              ready = true
              buffer.resolve(undefined)
              modeling.resolve(undefined)
              return updatesBeforeReady
            },
          }
        }, kind === 'local')
        const code = `${blankCode}// Outgoing edit\n`
        try {
          await editThroughUI(page, code)
          await page
            .getByRole('treeitem', { name: 'other.kcl', exact: true })
            .click()
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeVisible()
          await expect(
            page.locator('#code-mirror-override').locator('..')
          ).toHaveAttribute('inert', '')
          const clockStart = new Date()
          await page.clock.install({ time: clockStart })
          await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
          await page.clock.runFor(7_000)
          await expect
            .poll(() =>
              kind === 'cloud'
                ? cloudSaveStarted
                : gate.evaluate((gate) => gate.saveStarted())
            )
            .toBe(true)
          await page.clock.runFor(7_000)
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeVisible()
          await gate.evaluate((gate) => gate.releaseBuffer())
          await page.clock.resume()
          await expectEditor(page, `${blankCode}// Target buffer\n`)
          await expect(
            page.getByRole('status', { name: 'Loading file' })
          ).toBeHidden()
          expect(
            await originalProject.evaluate(
              (project) => window.app.project === project
            )
          ).toBe(true)
          await editThroughUI(page, `${blankCode}// Target buffer edited\n`)
          await page
            .getByRole('treeitem', { name: 'main.kcl', exact: true })
            .click()
          await expectEditor(page, code)
        } finally {
          save.resolve(undefined)
          expect(await gate.evaluate((gate) => gate.release())).toBe(0)
          await page.clock.resume()
        }
        await expect.poll(() => storage.read(root)).toBe(code)
        await expect
          .poll(() => storage.read(root, 'other.kcl'))
          .toBe(`${blankCode}// Target buffer edited\n`)
        await storage.assertStorage(root)
      })
    }
  )
}
