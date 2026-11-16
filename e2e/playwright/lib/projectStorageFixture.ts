import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import { FsFixture } from '@e2e/playwright/fixtures/fsFixture'
import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import { projectToml } from '@e2e/playwright/lib/cloudProjectTestUtils'
import {
  navigateToAppRoute,
  openProjectLibrary,
  selectProjectLibraries,
} from '@e2e/playwright/lib/appTestUtils'
import {
  mockClientErrorReports,
  setup,
  waitForAppLoad,
} from '@e2e/playwright/test-utils'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import {
  getDefaultCloudProjectLibrarySetting,
  type ProjectLibrarySetting,
} from '@src/lib/projectLibraries'

export type StorageKind = 'local' | 'cloud'

export async function prepareStorage(
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
  const navigate = (route: string) => navigateToAppRoute(page, route)
  await navigate('/home')
  await waitForAppLoad(page)
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
    await selectProjectLibraries(page, [library])
  }
  const enterLibrary = async () => {
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(
      /^(Project Libraries|Local Projects|Personal Cloud|Projects)$/
    )
    if ((await heading.innerText()) === 'Project Libraries') {
      await openProjectLibrary(page, library.title)
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
  const seedAndOpen = async (
    name: string,
    code: string,
    extraFiles: Record<string, string> = {}
  ) => {
    const root = await seed(name, code, extraFiles)
    await refresh()
    await home.openProject(name)
    return root
  }
  return {
    remote,
    fs,
    home,
    goHome,
    seed,
    seedAndOpen,
    read,
    replace,
    refresh,
    assertStorage,
    navigate,
  }
}
