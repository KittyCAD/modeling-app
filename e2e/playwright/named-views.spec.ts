import { test, expect } from './zoo-test'
import { PROJECT_SETTINGS_FILE_NAME } from 'lib/constants'
import * as fsp from 'fs/promises'
import { join } from 'path'
import { createProject, tomlToPerProjectSettings } from './test-utils'

const fileExists = async (path) => {
  return !!(await fsp
    .stat(path)
    .then((v) => true)
    .catch((e) => false))
}

test.describe('Named view tests', () => {
  test('Verify project.toml is not created', async ({ page }, testInfo) => {
    // Create project and load it
    const projectName = 'named-views'
    await createProject({ name: projectName, page })

    // Generate file paths for project.toml
    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    const tempProjectSettingsFilePath = join(
      projectDirName,
      projectName,
      PROJECT_SETTINGS_FILE_NAME
    )

    // project.toml should not exist on initial project creation
    let exists = await fileExists(tempProjectSettingsFilePath)
    expect(exists).toBe(false)
  })
  test('Verify named view gets created', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    const myNamedView = 'cool-named-view'

    // Create and load project
    await createProject({ name: projectName, page })
    await scene.waitForExecutionDone()

    // Create named view
    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView)
    await cmdBar.progressCmdBar(false)

    // Generate paths for the project.toml
    const tempProjectSettingsFilePath = join(
      projectDirName,
      projectName,
      PROJECT_SETTINGS_FILE_NAME
    )

    // Expect project.toml to be generated on disk since a named view was created
    await expect(async () => {
      let exists = await fileExists(tempProjectSettingsFilePath)
      expect(exists).toBe(true)
    }).toPass()

    // Read project.toml into memory
    const tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')

    // Write the entire tomlString to a snapshot.
    // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-created')
  })
  test('Verify named view gets deleted', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    const myNamedView = 'cool-named-view'

    // Create project and go into the project
    await createProject({ name: projectName, page })
    await scene.waitForExecutionDone()

    // Create a new named view
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView)
    await cmdBar.progressCmdBar(false)

    // Generate file paths for project.toml
    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    const tempProjectSettingsFilePath = join(
      projectDirName,
      projectName,
      PROJECT_SETTINGS_FILE_NAME
    )

    // Except the project.toml to be written to disk since a named view was created
    await expect(async () => {
      let exists = await fileExists(tempProjectSettingsFilePath)
      expect(exists).toBe(true)
    }).toPass()

    // Read project.toml into memory
    let tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')

    // Write the entire tomlString to a snapshot.
    // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-created')

    // Delete a named view
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('delete named view')
    cmdBar.selectOption({ name: myNamedView })
    await cmdBar.progressCmdBar(false)

    // // Read project.toml into memory
    tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')

    // // Write the entire tomlString to a snapshot.
    // // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-deleted')
  })
})
