import { test, expect } from './zoo-test'
import { PROJECT_SETTINGS_FILE_NAME } from 'lib/constants'
import * as fsp from 'fs/promises'
import { join } from 'path'
import {
  createProject,
  tomlToPerProjectSettings,
  perProjectsettingsToToml,
} from './test-utils'
import { NamedView } from '@rust/kcl-lib/bindings/NamedView'

// Helper function to determine if the file path on disk exists
// Specifically this is used to check if project.toml exists on disk
const fileExists = async (path: string) => {
  return !!(await fsp
    .stat(path)
    .then((_) => true)
    .catch((_) => false))
}

// Here are a few uuids.
// When created named views rust will auto generate uuids and they will
// never match the snapshots. Overwrite them in memory to these
// values to have them match the snapshots.
const uuid1: string = '0656fb1a-9640-473e-b334-591dc70c0138'
const uuid2: string = 'c810cf04-c6cc-4a4a-8b11-17bf445dcab7'
const uuid3: string = 'cfecbfee-48a6-4561-b96d-ffbe5678bb7d'

// Look up the named view by name and then rewrite it with the same uuid each time
const nameToUuid: Map<string, string> = new Map()
nameToUuid.set('uuid1', uuid1)
nameToUuid.set('uuid2', uuid2)
nameToUuid.set('uuid3', uuid3)

/**
 * Given the project.toml string, overwrite the named views to be the constant uuid
 * values to match the snapshots. The uuids are randomly generated
 */
function tomlStringOverWriteNamedViewUuids(toml: string): string {
  const settings = tomlToPerProjectSettings(toml)
  const namedViews = settings.settings?.app?.named_views
  if (namedViews) {
    const entries = Object.entries(namedViews)
    const remappedNamedViews: { [key: string]: NamedView } = {}
    entries.forEach(([_, value]) => {
      if (value) {
        // {name:'uuid1'} -> uuid1 lookup
        const staticUuid = nameToUuid.get(value.name)
        if (staticUuid) {
          remappedNamedViews[staticUuid] = value
        }
      }
    })
    if (settings && settings.settings && settings.settings.app) {
      settings.settings.app.named_views = remappedNamedViews
    }
  }
  return perProjectsettingsToToml(settings)
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
    const myNamedView = 'uuid1'

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
    let tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')
    // Rewrite the uuids in the named views to match snapshot otherwise they will be randomly generated from rust and break
    tomlString = tomlStringOverWriteNamedViewUuids(tomlString)

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
    const myNamedView1 = 'uuid1'
    const myNamedView2 = 'uuid2'

    // Create project and go into the project
    await createProject({ name: projectName, page })
    await scene.waitForExecutionDone()

    // Create a new named view
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView1)
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
    // Rewrite the uuids in the named views to match snapshot otherwise they will be randomly generated from rust and break
    tomlString = tomlStringOverWriteNamedViewUuids(tomlString)

    // Write the entire tomlString to a snapshot.
    // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-created')

    // Delete a named view
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('delete named view')
    cmdBar.selectOption({ name: myNamedView2 })
    await cmdBar.progressCmdBar(false)

    // Read project.toml into memory again since we deleted a named view
    tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')
    // Rewrite the uuids in the named views to match snapshot otherwise they will be randomly generated from rust and break
    tomlString = tomlStringOverWriteNamedViewUuids(tomlString)

    // // Write the entire tomlString to a snapshot.
    // // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-deleted')
  })
  test('Verify named view gets loaded', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    const myNamedView = 'uuid1'

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
    // Rewrite the uuids in the named views to match snapshot otherwise they will be randomly generated from rust and break
    tomlString = tomlStringOverWriteNamedViewUuids(tomlString)

    // Write the entire tomlString to a snapshot.
    // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-named-view-gets-created')

    // Create a load a named view
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('load named view')
    await cmdBar.argumentInput.fill(myNamedView)
    await cmdBar.progressCmdBar(false)

    // Check the toast appeared
    await expect(
      page.getByText(`Named view ${myNamedView} loaded.`)
    ).toBeVisible()
  })
  test('Verify two named views get created', async ({
    cmdBar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    const myNamedView1 = 'uuid1'
    const myNamedView2 = 'uuid2'

    // Create and load project
    await createProject({ name: projectName, page })
    await scene.waitForExecutionDone()

    // Create named view
    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView1)
    await cmdBar.progressCmdBar(false)

    await page.waitForTimeout(1000)

    const orbitMouseStart = { x: 800, y: 130 }
    const orbitMouseEnd = { x: 0, y: 130 }
    await page.mouse.move(orbitMouseStart.x, orbitMouseStart.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(orbitMouseEnd.x, orbitMouseEnd.y, {
      steps: 3,
    })
    await page.mouse.up({ button: 'middle' })

    await page.waitForTimeout(1000)

    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView2)
    await cmdBar.progressCmdBar(false)

    // Wait a moment for the project.toml to get written to disk with the new view point
    await page.waitForTimeout(1000)

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
    let tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')
    // Rewrite the uuids in the named views to match snapshot otherwise they will be randomly generated from rust and break
    tomlString = tomlStringOverWriteNamedViewUuids(tomlString)

    // Write the entire tomlString to a snapshot.
    // There are many key/value pairs to check this is a safer match.
    expect(tomlString).toMatchSnapshot('verify-two-named-view-gets-created')
  })
})
