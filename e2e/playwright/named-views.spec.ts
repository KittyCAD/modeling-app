import { join } from 'path'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import * as fsp from 'fs/promises'

import {
  createProject,
  runningOnWindows,
  tomlToPerProjectSettings,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

const PROJECT_NAME = 'named-views'

/**
 * A camera the `Create named view` command saved to `project.toml` before
 * named views moved into KCL. It is the app's default three-quarter view.
 */
const LEGACY_PROJECT_TOML = `title = "${PROJECT_NAME}"
default_file = "main.kcl"

[settings]
modeling = { }

[settings.app.named_views.0656fb1a-9640-473e-b334-591dc70c0138]
eye_offset = 20.907703
fov_y = 45
is_ortho = false
name = "uuid1"
ortho_scale_enabled = true
ortho_scale_factor = 1.6
pivot_position = [ 0, 0, 0 ]
pivot_rotation = [ 0.4247082, 0.1759199, 0.33985114, 0.8204732 ]
version = 1
world_coord_system = "right_handed_up_z"
`

/** `view::named()` exists from KCL 3.0 on. */
const KCL_V3_MAIN = `@settings(kclVersion = "3.0-preview")

width = 10
`

/** Files older than KCL 3.0 keep their named views in `project.toml`. */
const KCL_V2_MAIN = `@settings(kclVersion = 2.0)

width = 10
`

const fileExists = async (path: string) => {
  return !!(await fsp
    .stat(path)
    .then((_) => true)
    .catch((_) => false))
}

function projectPaths(projectDir: string) {
  return {
    mainKcl: join(projectDir, PROJECT_NAME, 'main.kcl'),
    projectToml: join(projectDir, PROJECT_NAME, PROJECT_SETTINGS_FILE_NAME),
  }
}

/** The named views `project.toml` holds, or none when it does not exist. */
async function legacyNamedViewNames(projectToml: string): Promise<string[]> {
  if (!(await fileExists(projectToml))) {
    return []
  }
  const settings = tomlToPerProjectSettings(
    await fsp.readFile(projectToml, 'utf-8')
  )
  return Object.values(settings.settings?.app?.named_views ?? {}).map(
    (view) => view?.name ?? ''
  )
}

function writeProject(mainKcl: string, projectToml?: string) {
  return async (dir: string) => {
    const projectDir = join(dir, PROJECT_NAME)
    await fsp.mkdir(projectDir, { recursive: true })
    await fsp.writeFile(join(projectDir, 'main.kcl'), mainKcl, 'utf-8')
    if (projectToml !== undefined) {
      await fsp.writeFile(
        join(projectDir, PROJECT_SETTINGS_FILE_NAME),
        projectToml,
        'utf-8'
      )
    }
  }
}

test.describe('Named view tests', { tag: '@desktop' }, () => {
  test.fail(runningOnWindows(), 'Windows line endings break file matching')

  test('Create named view writes a KCL named view', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const { mainKcl, projectToml } = projectPaths(
      testInfo.outputPath('electron-test-projects-dir')
    )

    await createProject({ name: PROJECT_NAME, page })
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill('uuid1')
    await cmdBar.progressCmdBar(false)
    await expect(page.getByText('Named view uuid1 created.')).toBeInViewport()

    await expect(async () => {
      const code = await fsp.readFile(mainKcl, 'utf-8')
      expect(code).toContain('view::named(\n  "uuid1",')
      expect(code).toContain('camera = view::directed(')
      expect(code).toContain('baseline = view::Visibility::Show,')
    }).toPass()
    expect(await legacyNamedViewNames(projectToml)).toEqual([])
  })

  test('Create named view numbers a name the file already uses', async ({
    cmdBar,
    scene,
    page,
  }) => {
    await createProject({ name: PROJECT_NAME, page })
    await scene.settled()

    for (const expected of ['uuid1', 'uuid1 (2)']) {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('create named view')
      await cmdBar.argumentInput.fill('uuid1')
      await cmdBar.progressCmdBar(false)
      await expect(
        page.getByText(`Named view ${expected} created.`)
      ).toBeInViewport()
      await scene.settled()
    }
  })

  test('Load named view moves to a KCL named view', async ({
    cmdBar,
    scene,
    page,
  }) => {
    await createProject({ name: PROJECT_NAME, page })
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill('uuid1')
    await cmdBar.progressCmdBar(false)
    await expect(page.getByText('Named view uuid1 created.')).toBeInViewport()
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('load named view')
    await cmdBar.selectOption({ name: 'uuid1' }).click()
    await expect(page.getByText('Named view uuid1 loaded.')).toBeVisible()
  })

  test('Delete named view removes the KCL named view', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const { mainKcl } = projectPaths(
      testInfo.outputPath('electron-test-projects-dir')
    )

    await createProject({ name: PROJECT_NAME, page })
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill('uuid1')
    await cmdBar.progressCmdBar(false)
    await expect(page.getByText('Named view uuid1 created.')).toBeInViewport()
    await expect(async () => {
      expect(await fsp.readFile(mainKcl, 'utf-8')).toContain('"uuid1"')
    }).toPass()
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('delete named view')
    await cmdBar.selectOption({ name: 'uuid1' }).click()
    await expect(page.getByText('Named view uuid1 removed.')).toBeInViewport()

    await expect(async () => {
      expect(await fsp.readFile(mainKcl, 'utf-8')).not.toContain('view::named')
    }).toPass()
  })

  test('Opening a project moves project.toml named views into main.kcl', async ({
    homePage,
    scene,
    page,
    folderSetupFn,
  }, testInfo) => {
    const { mainKcl, projectToml } = projectPaths(
      testInfo.outputPath('electron-test-projects-dir')
    )

    await folderSetupFn(writeProject(KCL_V3_MAIN, LEGACY_PROJECT_TOML))
    await homePage.openProject(PROJECT_NAME)
    await scene.settled()

    await expect(
      page.getByText(
        'Moved named view "uuid1" from project.toml into main.kcl.'
      )
    ).toBeVisible()

    await expect(async () => {
      const code = await fsp.readFile(mainKcl, 'utf-8')
      expect(code).toContain('width = 10')
      // The saved camera looks at the origin from front, right, and above.
      expect(code).toContain(`view::named(
  "uuid1",
  camera = view::directed(
    [-0.5774, 0.5774, -0.5774],
    up = [-0.4082, 0.4082, 0.8165],
    target = [0mm, 0mm, 0mm],
    distance = 20.9077mm,
    projection = view::Projection::Perspective,
  ),
  baseline = view::Visibility::Show,
)`)
      expect(await legacyNamedViewNames(projectToml)).toEqual([])
    }).toPass()
  })

  test('Files older than KCL 3.0 keep named views in project.toml', async ({
    homePage,
    cmdBar,
    scene,
    page,
    folderSetupFn,
  }, testInfo) => {
    const { mainKcl, projectToml } = projectPaths(
      testInfo.outputPath('electron-test-projects-dir')
    )

    await folderSetupFn(writeProject(KCL_V2_MAIN, LEGACY_PROJECT_TOML))
    await homePage.openProject(PROJECT_NAME)
    await scene.settled()

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill('uuid2')
    await cmdBar.progressCmdBar(false)
    await expect(page.getByText('Named view uuid2 created.')).toBeInViewport()

    await expect(async () => {
      expect((await legacyNamedViewNames(projectToml)).sort()).toEqual([
        'uuid1',
        'uuid2',
      ])
    }).toPass()
    expect(await fsp.readFile(mainKcl, 'utf-8')).toBe(KCL_V2_MAIN)

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('load named view')
    await cmdBar.selectOption({ name: 'uuid1' }).click()
    await expect(page.getByText('Named view uuid1 loaded.')).toBeVisible()
  })
})
