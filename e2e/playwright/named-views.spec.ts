import { test, expect, Page } from './zoo-test'
import { EditorFixture } from './fixtures/editorFixture'
import { SceneFixture } from './fixtures/sceneFixture'
import { ToolbarFixture } from './fixtures/toolbarFixture'
import { Locator } from '@playwright/test'
import path from 'path'
import { PROJECT_SETTINGS_FILE_NAME } from 'lib/constants'
import * as fsp from 'fs/promises'
import { join } from 'path'
import { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import {
  getUtils,
  executorInputPath,
  createProject,
  tomlToSettings,
  settingsToToml,
} from './test-utils'

const fileExists = async (path) => {
  return !!(await fsp
    .stat(path)
    .then((v) => true)
    .catch((e) => false))
}

// test file is for testing point an click code gen functionality that's not sketch mode related

test.describe('Named view tests', () => {
  test('Verify project.toml is not created', async ({
    context,
    homePage,
    cmdBar,
    editor,
    toolbar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    await createProject({ name: projectName, page })
    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    const tempProjectSettingsFilePath = join(
      projectDirName,
      projectName,
      PROJECT_SETTINGS_FILE_NAME
    )
    let exists = await fileExists(tempProjectSettingsFilePath)
    expect(exists).toBe(false)
    // await homePage.goToModelingScene()
    // await scene.waitForExecutionDone()
  })
  test('Verify named view gets created', async ({
    context,
    homePage,
    cmdBar,
    editor,
    toolbar,
    scene,
    page,
  }, testInfo) => {
    const projectName = 'named-views'
    const myNamedView = 'cool-named-view'
    await createProject({ name: projectName, page })
    await scene.waitForExecutionDone()

    const projectDirName = testInfo.outputPath('electron-test-projects-dir')
    await cmdBar.openCmdBar()
    await cmdBar.chooseCommand('create named view')
    await cmdBar.argumentInput.fill(myNamedView)
    await cmdBar.progressCmdBar(false)

    const tempProjectSettingsFilePath = join(
      projectDirName,
      projectName,
      PROJECT_SETTINGS_FILE_NAME
    )

    await expect(async () => {
      let exists = await fileExists(tempProjectSettingsFilePath)
      expect(exists).toBe(true)
    }).toPass()

    const tomlString = await fsp.readFile(tempProjectSettingsFilePath, 'utf-8')
    const settings = tomlToSettings(tomlString)
    if (settings) {
      const namedView = settings.settings?.app?.named_views?.length
    }
  })
})
