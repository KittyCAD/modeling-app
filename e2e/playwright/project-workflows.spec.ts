import { randomUUID } from 'node:crypto'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { expect, test as appTest } from '@e2e/playwright/zoo-test'
import { test as browserTest } from '@e2e/playwright/base-test'
import { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import {
  setup,
  waitForAppLoad,
  mockClientErrorReports,
  doAndWaitForImageDiff,
} from '@e2e/playwright/test-utils'
import {
  mockCloudStorage,
  uploadedProject,
} from '@e2e/playwright/lib/cloudStorageFixture'
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
  const navigate = async (route: string) => {
    if (process.env.TARGET === 'web') await page.goto(route)
    else {
      const url = new URL(page.url())
      url.hash = route
      await page.goto(url.toString())
      // Fragment navigation can retain the current document in Electron.
      // Direct entry must load storage again, as browser navigation does.
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
  }
  await navigate('/home')
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
    await waitForAppLoad(page)
    await page.waitForFunction(() =>
      window.app?.settings.actor.getSnapshot().matches('idle')
    )
    await page.evaluate((library) => {
      window.app.settings.actor.send({
        type: 'set.app.libraries',
        data: { level: 'user', value: [library] },
      })
    }, library)
    await page.waitForFunction(() =>
      window.app?.settings.actor.getSnapshot().matches('idle')
    )
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
      await expect(heading).toHaveText(library.title)
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
    navigate,
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

test('polls cloud project membership, pauses offline and stops outside the projects view @web', async ({
  page,
  context,
}, testInfo) => {
  const storage = await prepareStorage('cloud', page, context, testInfo)
  await storage.seed('Original cloud project', blankCode)
  await storage.refresh()
  const card = (title: string) =>
    storage.home.projectCard.filter({ hasText: title })
  await expect(card('Original cloud project')).toBeVisible()
  const clock = new Date()
  await page.clock.install({ time: clock })
  await page.clock.pauseAt(new Date(clock.getTime() + 1_000))
  const listRoute = /\/user\/projects(?:\?.*)?$/
  let requests = 0
  await context.route(listRoute, async (route) => {
    requests++
    await route.fallback()
  })
  try {
    await storage.seed('Added on another device', blankCode)
    await page.clock.runFor(2_000)
    await expect(card('Added on another device')).toBeVisible()
    const remote = storage.remote.projects.findIndex(
      (project) => project.title === 'Original cloud project'
    )
    storage.remote.projects.splice(remote, 1)
    await page.clock.runFor(2_000)
    await expect(card('Original cloud project')).not.toBeAttached()
    await context.setOffline(true)
    await page.waitForFunction(() => !navigator.onLine)
    await expect(
      page.getByRole('button', { name: 'Refresh projects' })
    ).toBeEnabled()
    const beforeOffline = requests
    await page.clock.runFor(7_000)
    expect(requests).toBe(beforeOffline)
    await context.setOffline(false)
    await page.clock.runFor(0)
    await expect.poll(() => requests).toBeGreaterThan(beforeOffline)
    await page.clock.resume()
    await storage.home.openProject('Added on another device')
    await expectEditor(page, blankCode)
    const afterLeaving = requests
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(new Date(now + 1_000))
    await page.clock.runFor(7_000)
    expect(requests).toBe(afterLeaving)
  } finally {
    await context.setOffline(false)
    await page.clock.resume()
    await context.unroute(listRoute)
  }
})

test(
  'shows loading feedback while listing and opening cloud projects',
  { tag: '@web' },
  async ({ page, context }, testInfo) => {
    const storage = await prepareStorage('cloud', page, context, testInfo)
    await storage.seed('Slow project', blankCode)
    await storage.refresh()
    const listing = Promise.withResolvers<undefined>()
    const opening = Promise.withResolvers<undefined>()
    // Record transient empty states too; polling after the request starts misses them.
    await page.addInitScript(() => {
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes)
            if (
              node instanceof Element &&
              (node.matches('[data-testid="projects-none"]') ||
                node.querySelector('[data-testid="projects-none"]'))
            )
              document.documentElement.dataset.emptyProjectsFlash = 'true'
      }).observe(document, { childList: true, subtree: true })
    })
    const listRoute = /\/user\/projects(?:\?.*)?$/
    let listingStarted = false
    let openingStarted = false
    await context.route(listRoute, async (route) => {
      listingStarted = true
      await listing.promise
      await route.fallback()
    })
    await context.route('**/user/projects/**/download?*', async (route) => {
      openingStarted = true
      await opening.promise
      await route.fallback()
    })
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(() => listingStarted).toBe(true)
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.emptyProjectsFlash
        )
      ).toBeUndefined()
      const listSpinner = page.getByRole('status', {
        name: 'Loading projects',
        exact: true,
      })
      await expect(listSpinner).toBeVisible()
      const clockStart = new Date()
      await page.clock.install({ time: clockStart })
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
      await page.clock.runFor(7_000)
      await expect(listSpinner).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('project-list-loading.png'),
      })
      await expect(page.getByTestId('projects-none')).not.toBeVisible()
      listing.resolve(undefined)
      await page.clock.resume()
      await expect(listSpinner).not.toBeVisible()
      await storage.home.openProject('Slow project')
      await expect.poll(() => openingStarted).toBe(true)
      const cardSpinner = page.getByRole('status', {
        name: 'Opening project Slow project',
        exact: true,
      })
      await expect(cardSpinner).toBeVisible()
      await page.clock.pauseAt(
        new Date((await page.evaluate(() => Date.now())) + 1_000)
      )
      await page.clock.runFor(7_000)
      await expect(cardSpinner).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('project-card-loading.png'),
      })
      opening.resolve(undefined)
      await page.clock.resume()
      await expectEditor(page, blankCode)
      await expect(cardSpinner).not.toBeAttached()
    } finally {
      listing.resolve(undefined)
      opening.resolve(undefined)
      await page.clock.resume()
      await context.unroute(listRoute)
      await context.unroute('**/user/projects/**/download?*')
    }
  }
)

// Both implementations execute the same actions and UI assertions. Naming policy
// and persistence inspection are the explicit implementation-specific boundaries.
for (const kind of ['local', 'cloud'] as const) {
  test.describe(
    `${kind} project workflow contract`,
    { tag: ['@web', '@desktop'] },
    () => {
      test('refreshes the project list and keeps existing cards', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        await storage.seed('Original project', blankCode)
        await storage.refresh()
        const card = (title: string) =>
          storage.home.projectCard.filter({ hasText: title })
        await expect(card('Original project')).toBeVisible()
        const gate = Promise.withResolvers<undefined>()
        let started = false
        const listRoute = /\/user\/projects(?:\?.*)?$/
        const button = page.getByRole('button', { name: 'Refresh projects' })
        await expect(button).toBeEnabled()
        if (kind === 'cloud') {
          const clock = new Date()
          await page.clock.install({ time: clock })
          await page.clock.pauseAt(new Date(clock.getTime() + 1_000))
          await context.route(listRoute, async (route) => {
            started = true
            await gate.promise
            await route.fallback()
          })
        }
        try {
          await storage.seed('Added project', blankCode)
          await button.click()
          if (kind === 'cloud') {
            await expect.poll(() => started).toBe(true)
            await expect(button).toBeDisabled()
            await expect(button).toHaveAttribute('aria-busy', 'true')
            await page.clock.runFor(7_000)
            await expect(button).toBeDisabled()
            await expect(card('Original project')).toBeVisible()
            gate.resolve(undefined)
            await page.clock.resume()
          }
          await expect(card('Added project')).toBeVisible()
          await expect(button).toBeEnabled()
          await expect(card('Original project')).toBeVisible()
        } finally {
          gate.resolve(undefined)
          if (kind === 'cloud') {
            await context.unroute(listRoute)
            await page.clock.resume()
          }
        }
      })

      test('adds a shape to a sketch that already contains a line', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const missingArtifacts: string[] = []
        page.on('console', (message) => {
          if (
            message.type() === 'error' &&
            message.text().includes('No artifact found with key')
          )
            missingArtifacts.push(message.text())
        })
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const initialCode = `${blankCode}profile = sketch(on = XY) {\n  line(start = [var 0mm, var 0mm], end = [var 2mm, var 2mm])\n}\n`
        const root = await storage.seed('Existing sketch', initialCode)
        await storage.refresh()
        await storage.home.openProject('Existing sketch')
        await scene.settled()
        await toolbar.openFeatureTreePane()
        const operation = await toolbar.getFeatureTreeOperation('profile', 0)
        await operation.dblclick()
        await expect(toolbar.exitSketchBtn).toBeEnabled()
        await page.getByTestId('point').click()
        const [click] = scene.makeMouseHelpers(0.7, 0.65, { format: 'ratio' })
        await click()
        await expect.poll(() => storage.read(root)).toContain('point(')
        await expect.poll(() => storage.read(root)).toContain('line(')
        await toolbar.lineBtn.click()
        const [startLine] = scene.makeMouseHelpers(0.3, 0.35, {
          format: 'ratio',
        })
        const [endLine] = scene.makeMouseHelpers(0.4, 0.7, { format: 'ratio' })
        await startLine()
        await expect(
          page.locator('[data-handle="sketch-point-handle"]')
        ).toHaveCount(5)
        await endLine()
        await page.keyboard.press('Escape')
        await expect
          .poll(
            async () =>
              (await storage.read(root))?.match(/line\(/g)?.length ?? 0
          )
          .toBe(2)
        expect(missingArtifacts).toEqual([])
      })

      test('reads newer file contents before inserting each sketch shape', async ({
        page,
        context,
      }, testInfo) => {
        test.setTimeout(180_000)
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const scene = new SceneFixture(page)
        const toolbar = new ToolbarFixture(page)
        const root = await storage.seed(
          'Fresh sketch contents',
          `${blankCode}width = 1\n`
        )
        await storage.refresh()
        await storage.home.openProject('Fresh sketch contents')
        await scene.settled()
        await page.evaluate(() =>
          window.app.project?.executingEditor.peek()?.unwatch()
        )
        await storage.replace(
          root,
          `${blankCode}// before creating the sketch\nwidth = 2\n`
        )
        await toolbar.startSketchOnDefaultPlane('Top plane')
        await expect.poll(() => storage.read(root)).toContain('sketch(')
        await expect
          .poll(() => storage.read(root))
          .toContain('// before creating the sketch')
        await page.getByTestId('point').click()
        for (const [index, position] of [
          [0.25, 0.35],
          [0.65, 0.6],
        ].entries()) {
          const previous = await storage.read(root)
          if (!previous) throw new Error('Missing saved sketch')
          const marker = `// external edit ${index}\n`
          await page.evaluate(() =>
            window.app.project?.executingEditor.peek()?.unwatch()
          )
          await storage.replace(root, marker + previous)
          const [click] = scene.makeMouseHelpers(position[0], position[1], {
            format: 'ratio',
          })
          await click()
          await expect(
            page.locator('[data-handle="sketch-point-handle"]')
          ).toHaveCount(index + 1)
          await expect.poll(() => storage.read(root)).toContain(marker.trim())
          await expect
            .poll(
              async () =>
                (await storage.read(root))?.match(/point\(/g)?.length ?? 0
            )
            .toBe(index + 1)
        }
      })

      test('revalidates identical code in different files after deleting an import', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const code = `${blankCode}import value from "dependency.kcl"\nresult = value\n`
        await storage.seed('Import diagnostics', blankCode, {
          'broken/one.kcl': code,
          'broken/dependency.kcl': `${blankCode}export value = 7\n`,
          'healthy/two.kcl': code,
          'healthy/dependency.kcl': `${blankCode}export value = 23\n`,
        })
        await storage.refresh()
        await storage.home.openProject('Import diagnostics')
        await new SceneFixture(page).settled()
        await expectEditor(page, blankCode)
        await page.evaluate(
          (id) => window.app.layout.openPane(id),
          DefaultLayoutPaneID.Files
        )
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('broken').click()
        await item('dependency.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('dependency.kcl')).not.toBeAttached()
        await item('healthy').click()
        const diagnostics = () =>
          page.evaluate(() =>
            window.app.singletons.kclManager.diagnostics.map(
              (diagnostic) => diagnostic.message
            )
          )
        for (let visit = 0; visit < 2; visit++) {
          await item('one.kcl').click()
          await expectEditor(page, code)
          await expect
            .poll(async () => (await diagnostics()).join('\n'))
            .toMatch(
              /(?:could not find file|Unable to read-file).*dependency\.kcl/i
            )
          await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
          await item('two.kcl').click()
          await expectEditor(page, code)
          await expect.poll(diagnostics).toEqual([])
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect
            .poll(() =>
              page.evaluate(
                () => window.app.singletons.kclManager.lastSuccessfulCode
              )
            )
            .toBe(code)
        }
      })

      test('revalidates an imported module after deleting another import from the open entrypoint', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const code = `${blankCode}import value from "dependency.kcl"\nimport healthyValue from "healthy.kcl"\nresult = value + healthyValue\n`
        const healthyCode = `${blankCode}export healthyValue = 23\n`
        await storage.seed('Active import diagnostics', code, {
          'dependency.kcl': `${blankCode}export value = 7\n`,
          'healthy.kcl': healthyCode,
        })
        await storage.refresh()
        await storage.home.openProject('Active import diagnostics')
        await new SceneFixture(page).settled()
        await expectEditor(page, code)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(code)
        await page.evaluate(
          (id) => window.app.layout.openPane(id),
          DefaultLayoutPaneID.Files
        )
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('dependency.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('dependency.kcl')).not.toBeAttached()
        // Re-execute the importer after deletion before switching modules.
        await editThroughUI(page, `${code}\n`)
        await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
        await item('healthy.kcl').click()
        await expectEditor(page, healthyCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(healthyCode)
      })

      test('clears errors when deleting the open file and switching to a valid file', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo, {
          modeling: true,
        })
        const brokenCode = `${blankCode}import value from "missing.kcl"\nresult = value\n`
        const healthyCode = `${blankCode}result = 23\n`
        await storage.seed('Deleted editor diagnostics', blankCode, {
          'broken.kcl': brokenCode,
          'healthy.kcl': healthyCode,
        })
        await storage.refresh()
        await storage.home.openProject('Deleted editor diagnostics')
        await new SceneFixture(page).settled()
        await expectEditor(page, blankCode)
        await page.evaluate(
          (id) => window.app.layout.openPane(id),
          DefaultLayoutPaneID.Files
        )
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('broken.kcl').click()
        await expectEditor(page, brokenCode)
        await expect(page.locator('.cm-lint-marker-error')).not.toHaveCount(0)
        await item('broken.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(item('broken.kcl')).not.toBeAttached()
        await expectEditor(page, blankCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await item('healthy.kcl').click()
        await expectEditor(page, healthyCode)
        await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
        await expect
          .poll(() =>
            page.evaluate(
              () => window.app.singletons.kclManager.lastSuccessfulCode
            )
          )
          .toBe(healthyCode)
      })

      test('recovers a failed save through the editor without losing edits', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seed('Recoverable save', blankCode)
        await storage.refresh()
        await storage.home.openProject('Recoverable save')
        await expectEditor(page, blankCode)
        const code = `${blankCode}// Retained after a failed save\n`
        const gate = Promise.withResolvers<undefined>()
        let started = false
        let fail = true
        if (kind === 'cloud')
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && fail) {
              const upload = await uploadedProject(route)
              if (upload.files['main.kcl'] === code) {
                started = true
                await gate.promise
                return route.fulfill({
                  status: 503,
                  json: { message: 'Storage unavailable' },
                })
              }
            }
            await route.fallback()
          })
        // Inject at the local writer boundary; persistence after recovery is real.
        const localFailure = await page.evaluateHandle((local) => {
          const io = window.app.singletons.kclManager.textFileIO
          const write = io.write.bind(io)
          const gate = Promise.withResolvers<undefined>()
          let started = false
          if (local)
            Object.assign(io, {
              write: async () => {
                started = true
                await gate.promise
                return Promise.reject(
                  Object.assign(new Error('Disk unavailable'), {
                    code: 'ENOSPC',
                  })
                )
              },
            })
          return {
            started: () => started,
            release: () => gate.resolve(undefined),
            restore: () => {
              Object.assign(io, { write })
            },
          }
        }, kind === 'local')
        try {
          await editThroughUI(page, code)
          await expect
            .poll(() =>
              kind === 'cloud'
                ? started
                : localFailure.evaluate((f) => f.started())
            )
            .toBe(true)
          const clockStart = new Date()
          await page.clock.install({ time: clockStart })
          await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
          await page.clock.runFor(7_000)
          await expect(
            page.getByRole('status').filter({ hasText: 'Saving...' })
          ).toBeVisible()
          await expectEditor(page, code)
          expect(await storage.read(root)).toBe(blankCode)
          gate.resolve(undefined)
          await localFailure.evaluate((f) => f.release())
          await page.clock.resume()
          const retry = page.getByRole('button', { name: 'Save failed. Retry' })
          await expect(retry).toBeVisible()
          await expectEditor(page, code)
          expect(await storage.read(root)).toBe(blankCode)
          fail = false
          await localFailure.evaluate((f) => f.restore())
          await retry.click()
          await expect.poll(() => storage.read(root)).toBe(code)
          await expect(retry).toBeHidden()
          await expect
            .poll(() =>
              page.evaluate(() =>
                window.app.singletons.kclManager.hasUnsavedLocalChanges()
              )
            )
            .toBe(false)
        } finally {
          gate.resolve(undefined)
          await localFailure.evaluate((f) => {
            f.release()
            f.restore()
          })
          await page.clock.resume()
        }
        await storage.refresh()
        await expectEditor(page, code)
        await storage.assertStorage(root)
      })

      test('renames and deletes nested files without changing unrelated contents', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const nestedCode = `${blankCode}// Nested file\n`
        const root = await storage.seed('Nested operations', blankCode, {
          'parts/source.kcl': nestedCode,
          'parts/existing.kcl': `${blankCode}// Keep existing\n`,
          'unrelated/keep.kcl': `${blankCode}// Keep unrelated\n`,
        })
        await storage.refresh()
        await storage.home.openProject('Nested operations')
        await expectEditor(page, blankCode)
        await page.evaluate(
          (id) => window.app.layout.openPane(id),
          DefaultLayoutPaneID.Files
        )
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        if ((await item('parts').getAttribute('aria-expanded')) !== 'true')
          await item('parts').click()
        await item('source.kcl').click()
        await expectEditor(page, nestedCode)
        const rename = async (name: string) => {
          await item('source.kcl').click({ button: 'right' })
          await page.getByTestId('context-menu-rename').click()
          await page.getByTestId('file-rename-field').fill(name)
          await page.keyboard.press('Enter')
          await expect(page.getByTestId('file-rename-field')).not.toBeAttached()
        }
        await rename('existing.kcl')
        await expect(item('source.kcl')).toBeVisible()
        await expectEditor(page, nestedCode)
        expect(await storage.read(root, 'parts/existing.kcl')).toBe(
          `${blankCode}// Keep existing\n`
        )
        await rename('renamed.kcl')
        await expect(item('renamed.kcl')).toBeVisible()
        await expect(item('source.kcl')).toBeHidden()
        await expect(page).toHaveURL(/renamed\.kcl$/)
        await expectEditor(page, nestedCode)
        await expect
          .poll(() => storage.read(root, 'parts/renamed.kcl'))
          .toBe(nestedCode)
        await storage.refresh()
        await expectEditor(page, nestedCode)
        await item('renamed.kcl').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(page).toHaveURL(/main\.kcl$/)
        await expectEditor(page, blankCode)
        await expect(item('renamed.kcl')).toBeHidden()
        await expect
          .poll(() => storage.read(root, 'unrelated/keep.kcl'))
          .toBe(`${blankCode}// Keep unrelated\n`)
        await storage.refresh()
        await expectEditor(page, blankCode)
        await expect(item('renamed.kcl')).toBeHidden()
        await storage.assertStorage(root)
      })

      test('creates a nested file, renames its folder and deletes it while keeping the project root', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        const root = await storage.seed('Nested creation', blankCode, {
          'parts/existing.kcl': blankCode,
        })
        await storage.refresh()
        await storage.home.openProject('Nested creation')
        await expectEditor(page, blankCode)
        await page.evaluate(
          (id) => window.app.layout.openPane(id),
          DefaultLayoutPaneID.Files
        )
        const item = (name: string) =>
          page.getByRole('treeitem', { name, exact: true })
        await item('parts').click()
        await page.getByTestId('create-file-button').click()
        await page.getByTestId('file-rename-field').fill('created')
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/parts%2Fcreated\.kcl$/)
        await expect(item('created.kcl')).toBeVisible()
        await expect
          .poll(() => storage.read(root, 'parts/created.kcl'))
          .toMatch(/^@settings\(/)
        expect(await page.evaluate(() => window.app.project?.path)).toBe(root)
        expect(await storage.read(root)).toBe(blankCode)
        await item('parts').click({ button: 'right' })
        await page.getByTestId('context-menu-rename').click()
        await page.getByTestId('file-rename-field').fill('components')
        await page.keyboard.press('Enter')
        await expect(page).toHaveURL(/components%2Fcreated\.kcl$/)
        await expect(item('parts')).toBeHidden()
        await expect(item('components')).toBeVisible()
        expect(await page.evaluate(() => window.app.project?.path)).toBe(root)
        await expect
          .poll(() => storage.read(root, 'components/existing.kcl'))
          .toBe(blankCode)
        await storage.refresh()
        await expect(item('components')).toBeVisible()
        await item('components').click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByTestId('delete-confirmation').click()
        await expect(page).toHaveURL(/main\.kcl$/)
        await expectEditor(page, blankCode)
        await expect(item('components')).toBeHidden()
        await storage.refresh()
        await expectEditor(page, blankCode)
        await expect(item('components')).toBeHidden()
        expect(await storage.read(root)).toBe(blankCode)
        await storage.assertStorage(root)
      })

      test('renames and deletes a project from Home while preserving the other project', async ({
        page,
        context,
      }, testInfo) => {
        const storage = await prepareStorage(kind, page, context, testInfo)
        await storage.seed('Rename me', blankCode)
        const otherCode = `${blankCode}// Other project\n`
        const other = await storage.seed('Keep me', otherCode)
        await storage.refresh()
        const card = (title: string) =>
          storage.home.projectCard.filter({ hasText: title })
        const originalHref = await card('Rename me').getAttribute('href')
        if (!originalHref) throw new Error('Missing project link')
        await card('Rename me').click({ button: 'right' })
        await page.getByTestId('project-card-context-rename').click()
        await page.getByTestId('project-rename-input').fill('Renamed project')
        await page.keyboard.press('Enter')
        await expect(card('Renamed project')).toBeVisible()
        await expect(card('Rename me')).toBeHidden()
        await expect(page.getByTestId('project-rename-input')).toBeHidden()
        await expect(card('Renamed project')).toHaveAttribute(
          'href',
          originalHref
        )
        await storage.home.openProject('Renamed project')
        await expectEditor(page, blankCode)
        await storage.refresh()
        await expectEditor(page, blankCode)
        await storage.goHome()
        await card('Renamed project').click({ button: 'right' })
        await page.getByTestId('project-card-context-delete').click()
        await page
          .getByRole('dialog', { name: 'Delete Project', exact: true })
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        await expect(card('Renamed project')).toBeHidden()
        await expect(card('Keep me')).toBeVisible()
        await storage.refresh()
        await expect(card('Renamed project')).toBeHidden()
        expect(await storage.read(other)).toBe(otherCode)
        await storage.home.openProject('Keep me')
        await expectEditor(page, otherCode)
        await storage.assertStorage(other)
      })

      if (kind === 'cloud') {
        test('replaces a non-KCL editor with the cloud contents after a conflict', async ({
          page,
          context,
        }, testInfo) => {
          const storage = await prepareStorage(kind, page, context, testInfo)
          const root = await storage.seed('Text conflict', blankCode, {
            'note.md': '# Original note\n',
          })
          await storage.refresh()
          await storage.home.openProject('Text conflict')
          await expectEditor(page, blankCode)
          await page.evaluate(
            (id) => window.app.layout.openPane(id),
            DefaultLayoutPaneID.Files
          )
          await page
            .getByRole('treeitem', { name: 'note.md', exact: true })
            .click()
          await expectEditor(page, '# Original note\n')
          const remote = storage.remote.projects[0]
          let conflict = true
          let beforeConflict: string[] = []
          let submittedRevision = ''
          await context.route('**/user/projects/**', async (route) => {
            if (route.request().method() === 'PUT' && conflict) {
              const upload = await uploadedProject(route)
              if (upload.files['note.md'] === '# Stale local note\n') {
                conflict = false
                beforeConflict = [...storage.remote.uploads]
                submittedRevision = remote.revision
                remote.files['note.md'] = '# Cloud truth\n'
                remote.revision = String(Number(remote.revision) + 1)
              }
            }
            await route.fallback()
          })
          await editThroughUI(page, '# Stale local note\n')
          await expectEditor(page, '# Cloud truth\n')
          await expect
            .poll(() => storage.read(root, 'note.md'))
            .toBe('# Cloud truth\n')
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
          ])
          const clockStart = new Date()
          await page.clock.install({ time: clockStart })
          await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
          await page.clock.runFor(7_000)
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
          ])
          await page.clock.resume()
          const cloudRevision = remote.revision
          await editThroughUI(page, '# Fresh note\n')
          await expect
            .poll(() => storage.read(root, 'note.md'))
            .toBe('# Fresh note\n')
          expect(storage.remote.uploads).toEqual([
            ...beforeConflict,
            submittedRevision,
            cloudRevision,
          ])
          await storage.refresh()
          await expectEditor(page, blankCode)
          await page
            .getByRole('treeitem', { name: 'note.md', exact: true })
            .click()
          await expectEditor(page, '# Fresh note\n')
        })
        for (const outcome of ['same', 'different'] as const) {
          test(`recovers a lost save acknowledgement using the cloud snapshot (${outcome} contents)`, async ({
            page,
            context,
          }, testInfo) => {
            const storage = await prepareStorage(kind, page, context, testInfo)
            const root = await storage.seed('Conflict recovery', blankCode)
            await storage.refresh()
            await storage.home.openProject('Conflict recovery')
            await expectEditor(page, blankCode)
            const code = `${blankCode}// Uploaded before connection loss\n`
            let loseAcknowledgement = true
            let beforeLoss: string[] = []
            let submittedRevision = ''
            await context.route('**/user/projects/**', async (route) => {
              if (route.request().method() === 'PUT' && loseAcknowledgement) {
                const upload = await uploadedProject(route)
                if (upload.files['main.kcl'] === code) {
                  loseAcknowledgement = false
                  const remote = storage.remote.projects[0]
                  submittedRevision = (await uploadedProject(route)).metadata
                    .expected_revision!
                  expect(submittedRevision).toBe(remote.revision)
                  beforeLoss = [...storage.remote.uploads]
                  remote.files = upload.files
                  remote.title = upload.title
                  remote.revision = String(Number(remote.revision) + 1)
                  return route.abort('connectionreset')
                }
              }
              await route.fallback()
            })
            await editThroughUI(page, code)
            const retry = page.getByRole('button', {
              name: 'Save failed. Retry',
            })
            await expect(retry).toBeVisible()
            const authoritative =
              outcome === 'same'
                ? code
                : `${blankCode}// Changed by another client\n`
            if (outcome === 'different')
              await storage.replace(root, authoritative)
            await retry.click()
            await expect(retry).toBeHidden()
            await expectEditor(page, authoritative)

            await expect
              .poll(() =>
                page.evaluate(() =>
                  window.app.singletons.kclManager.hasUnsavedLocalChanges()
                )
              )
              .toBe(false)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
            ])
            const clockStart = new Date()
            await page.clock.install({ time: clockStart })
            await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
            await page.clock.runFor(7_000)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
            ])
            await page.clock.resume()
            const cloudRevision = storage.remote.projects[0].revision
            const next = `${authoritative}// Fresh edit after recovery\n`
            await editThroughUI(page, next)
            await expect.poll(() => storage.read(root)).toBe(next)
            expect(storage.remote.uploads).toEqual([
              ...beforeLoss,
              submittedRevision,
              cloudRevision,
            ])
            await storage.refresh()
            await expectEditor(page, next)
          })
        }
      }

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
          await storage.navigate(`/file/${encodeURIComponent(main)}`)
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
