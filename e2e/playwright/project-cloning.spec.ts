import { expect, test as browserTest } from '@e2e/playwright/base-test'
import { test as appTest } from '@e2e/playwright/zoo-test'
import {
  mockCloudStorage,
  uploadedProject,
} from '@e2e/playwright/lib/cloudStorageFixture'
import { projectToml } from '@e2e/playwright/lib/cloudProjectTestUtils'
import { mockClientErrorReports, setup } from '@e2e/playwright/test-utils'
import { getDefaultCloudProjectLibrarySetting } from '@src/lib/projectLibraries'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'

const web = process.env.TARGET === 'web'
const test = web ? browserTest : appTest

type Kind = 'local' | 'cloud'
const originalId = '12902000-0000-4000-8000-000000000099'
const originalCode = '@settings(kclVersion = 3.0)\n// original\n'
const editedCode = '@settings(kclVersion = 3.0)\n// edited during clone\n'
const originalToml = `${projectToml('Original')}\n[settings.meta]\nid = "${originalId}"\n[zookeeper."dev.zoo.dev"]\nconversation_ids = ["previous-conversation"]\n[custom]\nkeep = "yes"\n`

async function prepare(
  source: Kind,
  destination: Kind,
  context: BrowserContext,
  page: Page,
  info: TestInfo
) {
  await mockClientErrorReports(context)
  const remote = await mockCloudStorage(context, {
    startEmpty: source !== 'cloud',
  })
  remote.project.title = 'Original'
  remote.project.files = {
    'main.kcl': originalCode,
    'project.toml': originalToml,
    'parts/note.md': 'nested bytes',
  }
  if (web) await setup(context, page, info)
  const navigate = async (route: string) => {
    if (web) await page.goto(route)
    else {
      const url = new URL(page.url())
      url.hash = route
      await page.goto(url.toString())
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
  }
  await navigate('/home')
  await expect(page.getByTestId('home-header')).toBeVisible()
  const localSource = {
    type: 'directory' as const,
    title: 'Source',
    path: web ? '/documents/clone-source' : info.outputPath('clone-source'),
  }
  const localDestination = {
    type: 'directory' as const,
    title: 'Destination',
    path: web
      ? '/documents/clone-destination'
      : info.outputPath('clone-destination'),
  }
  const cloud = getDefaultCloudProjectLibrarySetting()
  const sourceLibrary = source === 'local' ? localSource : cloud
  const destinationLibrary = destination === 'local' ? localDestination : cloud
  const root = await page.evaluate(
    ({ source, localPath, id }) =>
      source === 'local'
        ? window.fsZds.join(localPath, 'original')
        : window.fsZds.resolve('/__zoo_cloud__', id),
    { source, localPath: localSource.path, id: remote.project.id }
  )
  await page.evaluate(
    async ({ root, files, source, libraries, destinationPath }) => {
      const fs = window.fsZds
      if (source === 'local') {
        await fs.mkdir(`${root}/parts`, { recursive: true })
        for (const [path, contents] of Object.entries(files))
          await fs.writeFile(
            `${root}/${path}`,
            new TextEncoder().encode(contents)
          )
      }
      await fs.mkdir(destinationPath, { recursive: true })
      window.app.settings.actor.send({
        type: 'set.app.libraries',
        data: { level: 'user', value: libraries },
      })
    },
    {
      root,
      files: remote.project.files,
      source,
      libraries: [sourceLibrary, destinationLibrary],
      destinationPath: localDestination.path,
    }
  )
  await expect
    .poll(() =>
      page.evaluate(() => window.app.settings.actor.getSnapshot().value)
    )
    .toBe('idle')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('home-header')).toBeVisible()
  const openLibrary = page.getByRole('link', {
    name: `Open ${sourceLibrary.title} library`,
    exact: true,
  })
  if (await openLibrary.isVisible()) await openLibrary.click()
  const card = page
    .getByTestId('project-link')
    .filter({ has: page.getByText('Original', { exact: true }) })
  await expect(card).toBeVisible()
  const clone = async () => {
    await card.click({ button: 'right' })
    await page.getByTestId('project-card-context-clone-to-library').click()
    await expect(
      page
        .locator(
          '[data-testid="command-bar-continue"], [data-testid="command-bar-submit"]'
        )
        .first()
    ).toBeVisible()
    const next = page.getByTestId('command-bar-continue')
    if (await next.isVisible()) await next.click()
    await expect(page.getByText('The original', { exact: false })).toBeVisible()
    await page.getByTestId('command-bar-submit').click()
  }
  const readSource = async (file: string) =>
    source === 'cloud'
      ? remote.project.files[file]
      : page.evaluate(
          async (path) =>
            new TextDecoder().decode(
              await window.app.fileOperations.readFile(path)
            ),
          `${root}/${file}`
        )
  return {
    remote,
    root,
    clone,
    readSource,
    openProject: async (projectPath: string) => {
      const filePath = await page.evaluate(
        (root) => window.fsZds.join(root, 'main.kcl'),
        projectPath
      )
      await navigate(`/file/${encodeURIComponent(filePath)}`)
    },
    destinationDirectory: localDestination.path,
  }
}

for (const [source, destination] of [
  ['local', 'local'],
  ['local', 'cloud'],
  ['cloud', 'local'],
] as const) {
  test(
    `clones ${source} to ${destination} as an independent project and keeps the source`,
    { tag: ['@web', '@desktop'] },
    async ({ context, page }, info) => {
      const storage = await prepare(source, destination, context, page, info)
      const started = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      if (destination === 'cloud')
        await context.route('**/user/projects', async (route) => {
          if (route.request().method() === 'POST') {
            started.resolve(undefined)
            await release.promise
          }
          await route.fallback()
        })
      try {
        await storage.clone()
        if (destination === 'cloud') {
          await started.promise
          const clockStart = new Date()
          await page.clock.install({ time: clockStart })
          await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
          await page.clock.runFor(7_000)
          await page.evaluate(
            async ({ root, contents }) =>
              window.app.fileOperations.writeFile(`${root}/main.kcl`, contents),
            { root: storage.root, contents: editedCode }
          )
          expect(await storage.readSource('main.kcl')).toBe(editedCode)
          expect(storage.remote.projects).toHaveLength(0)
          release.resolve(undefined)
          await page.clock.resume()
        }
        await expect(page.getByTestId('command-bar-wrapper')).toBeHidden()
        expect(await storage.readSource('main.kcl')).toBe(
          destination === 'cloud' ? editedCode : originalCode
        )
        expect(await storage.readSource('project.toml')).toBe(originalToml)
        expect(await storage.readSource('parts/note.md')).toBe('nested bytes')
        const target = await page.evaluate(
          ({ destination, id, directory }) =>
            destination === 'cloud'
              ? window.fsZds.resolve('/__zoo_cloud__', id)
              : window.fsZds.join(directory, 'original'),
          {
            destination,
            id: storage.remote.creates[0]?.id ?? '',
            directory: storage.destinationDirectory,
          }
        )
        await expect(
          page.getByText(
            `Created a clone of "Original" in "${destination === 'cloud' ? 'Personal Cloud' : 'Destination'}".`,
            { exact: true }
          )
        ).toBeVisible()
        await storage.openProject(target)
        await expect(page.locator('.cm-content').first()).toContainText(
          '// original'
        )
        const files = await page.evaluate(
          async (root) =>
            Promise.all(
              ['project.toml', 'parts/note.md'].map(async (file) =>
                new TextDecoder().decode(
                  await window.app.fileOperations.readFile(`${root}/${file}`)
                )
              )
            ),
          target
        )
        expect(files[0]).not.toContain(originalId)
        expect(files[0]).not.toContain('previous-conversation')
        expect(files[0]).toContain('keep = "yes"')
        expect(files[1]).toBe('nested bytes')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.locator('.cm-content').first()).toContainText(
          '// original'
        )
        await storage.openProject(storage.root)
        await expect(page.locator('.cm-content').first()).toContainText(
          destination === 'cloud' ? '// edited during clone' : '// original'
        )
      } finally {
        release.resolve(undefined)
      }
    }
  )
}

test(
  'a failed seven-second cloud clone preserves the source and its later edits',
  { tag: ['@web', '@desktop'] },
  async ({ context, page }, info) => {
    const storage = await prepare('local', 'cloud', context, page, info)
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    await context.route('**/user/projects', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      expect((await uploadedProject(route)).files['main.kcl']).toBe(
        originalCode
      )
      started.resolve(undefined)
      await release.promise
      await route.fulfill({
        status: 503,
        json: { message: 'Destination unavailable' },
      })
    })
    try {
      await storage.clone()
      await started.promise
      const clockStart = new Date()
      await page.clock.install({ time: clockStart })
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1_000))
      await page.clock.runFor(7_000)
      await page.evaluate(
        async ({ root, contents }) =>
          window.app.fileOperations.writeFile(`${root}/main.kcl`, contents),
        { root: storage.root, contents: editedCode }
      )
      release.resolve(undefined)
      await page.clock.resume()
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: 'Failed to execute command: Clone project' })
      ).toBeVisible()
      expect(storage.remote.projects).toHaveLength(0)
      expect(await storage.readSource('main.kcl')).toBe(editedCode)
      expect(await storage.readSource('project.toml')).toBe(originalToml)
      await storage.openProject(storage.root)
      await expect(page.locator('.cm-content').first()).toContainText(
        '// edited during clone'
      )
    } finally {
      release.resolve(undefined)
    }
  }
)
