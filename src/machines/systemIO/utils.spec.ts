import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import {
  collectProjectFiles,
  normalizeKCLFileDeletePath,
  prepareMlEphantNewFileRequest,
} from '@src/machines/systemIO/utils'
import { beforeAll, describe, expect, it } from 'vitest'

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('System IO Utils', () => {
  it('uses selected editor contents over stale disk contents when collecting project files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zds-zk-files-'))
    const projectPath = path.join(root, 'demo-project')
    const mainPath = path.join(projectPath, 'main.kcl')
    const helperPath = path.join(projectPath, 'helper.kcl')

    try {
      await fs.mkdir(projectPath)
      await fs.writeFile(mainPath, 'disk width = 500')
      await fs.writeFile(helperPath, 'helper = 1')

      const projectFiles = await collectProjectFiles({
        selectedFileContents: 'editor width = 80',
        selectedFilePath: mainPath,
        fileNames: {},
        projectContext: {
          metadata: null,
          kcl_file_count: 2,
          directory_count: 0,
          default_file: mainPath,
          path: projectPath,
          name: 'demo-project',
          children: [
            { name: 'main.kcl', path: mainPath, children: null },
            { name: 'helper.kcl', path: helperPath, children: null },
          ],
          readWriteAccess: true,
        },
      })

      const mainFile = projectFiles.find(
        (file) => file.type === 'kcl' && file.relPath === 'main.kcl'
      )
      const helperFile = projectFiles.find(
        (file) => file.type === 'kcl' && file.relPath === 'helper.kcl'
      )

      expect(mainFile).toMatchObject({
        type: 'kcl',
        fileContents: 'editor width = 80',
      })
      expect(helperFile).toMatchObject({
        type: 'kcl',
        fileContents: 'helper = 1',
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('matches selected editor contents by project-relative path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zds-zk-files-'))
    const projectPath = path.join(root, 'demo-project')
    const mainPath = path.join(projectPath, 'main.kcl')

    try {
      await fs.mkdir(projectPath)
      await fs.writeFile(mainPath, 'disk length = 100')

      const projectFiles = await collectProjectFiles({
        selectedFileContents: 'editor length = 120',
        selectedFilePath: 'main.kcl',
        fileNames: {},
        projectContext: {
          metadata: null,
          kcl_file_count: 1,
          directory_count: 0,
          default_file: mainPath,
          path: projectPath,
          name: 'demo-project',
          children: [{ name: 'main.kcl', path: mainPath, children: null }],
          readWriteAccess: true,
        },
      })

      expect(projectFiles).toContainEqual(
        expect.objectContaining({
          type: 'kcl',
          relPath: 'main.kcl',
          fileContents: 'editor length = 120',
        })
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('Properly reconstructs paths from Zookeeper new file requests', () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      toolOutput: {
        status_code: 201,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          '7/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '9/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\nboxColor = "#00ff00"\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n  |> appearance(color = boxColor)\n',
          '4/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '6/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '5/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          'main.kcl': '',
          '1/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '8/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '3/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
          '2/main.kcl':
            '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        },
      },
    })

    expect(preparedPayload).toBeDefined()
    expect(preparedPayload?.files).toEqual([
      {
        requestedFileName: '7/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '9/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\nboxColor = "#00ff00"\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n  |> appearance(color = boxColor)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '4/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '6/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '5/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: 'main.kcl',
        requestedCode: '',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '1/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '8/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '3/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
      {
        requestedFileName: '2/main.kcl',
        requestedCode:
          '@settings(defaultLengthUnit = mm)\n\nlength = 10\nwidth = 10\nheight = 10\n\nsketch = startSketchOn(XY)\n\nprofile = startProfile(sketch, at = [-length / 2, -width / 2])\n  |> xLine(length = length)\n  |> yLine(length = width)\n  |> xLine(length = -length)\n  |> close()\n\nbox = extrude(profile, length = height)\n',
        requestedProjectName: 'some-project',
      },
    ])
  })

  it('preserves files by default when preparing Zookeeper edit requests', () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      toolOutput: {
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          'main.kcl': 'cube = 1',
        },
      },
    })

    expect(preparedPayload?.files).toEqual([
      {
        requestedFileName: 'main.kcl',
        requestedCode: 'cube = 1',
        requestedProjectName: 'some-project',
      },
    ])
    expect(preparedPayload?.filesToDelete).toEqual([])
  })

  it('collects project files from disk and excludes .gitignore patterns', async () => {
    const projectPath = `/tmp/opencode/zookeeper-project-${crypto.randomUUID()}`
    await fsZds.mkdir(fsZds.join(projectPath, '.hidden-dir'), {
      recursive: true,
    })
    await fsZds.mkdir(fsZds.join(projectPath, 'dist'), { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'main.kcl'),
      new TextEncoder().encode('cube()')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'notes.txt'),
      new TextEncoder().encode('notes')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'project.toml'),
      new TextEncoder().encode('[settings.app]')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, '.gitignore'),
      new TextEncoder().encode('dist\nnotes.txt\n.hidden-dir/\n')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, '.hidden-dir', 'secret.txt'),
      new TextEncoder().encode('secret')
    )
    await fsZds.writeFile(
      fsZds.join(projectPath, 'dist', 'ignored.kcl'),
      new TextEncoder().encode('ignored = 1')
    )

    try {
      const projectFiles = await collectProjectFiles({
        selectedFileContents: 'cube()',
        fileNames: {
          0: {
            type: 'Local',
            value: fsZds.join(projectPath, 'main.kcl'),
            original_import_path: null,
          },
        },
        projectContext: {
          name: 'zookeeper-project',
          path: projectPath,
          children: [
            {
              name: 'main.kcl',
              path: fsZds.join(projectPath, 'main.kcl'),
              children: null,
            },
          ],
          metadata: null,
          kcl_file_count: 1,
          directory_count: 0,
          default_file: fsZds.join(projectPath, 'main.kcl'),
          readWriteAccess: true,
        },
      })

      expect(projectFiles.map((file) => file.relPath).sort()).toEqual([
        '.gitignore',
        'main.kcl',
        'project.toml',
      ])
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps the currently focused file as the navigation target after project-wide edits', () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'newFile.kcl',
        path: '/projects/some-project/newFile.kcl',
        children: null,
      },
      toolOutput: {
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          'main.kcl': 'width = 5',
          'newFile.kcl': 'width = 10',
        },
      },
    })

    expect(preparedPayload?.requestedFileNameWithExtension).toBe('newFile.kcl')
  })

  it('carries only explicit Zookeeper delete signals into edit requests', () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      filesToDelete: [{ requestedFileName: 'old.kcl' }],
      toolOutput: {
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          'main.kcl': 'cube = 1',
        },
      },
    })

    expect(preparedPayload?.filesToDelete).toEqual([
      { requestedFileName: 'old.kcl' },
    ])
  })

  it('matches explicit Zookeeper delete signals across path separators', () => {
    const requestedFilesToDelete = new Set(
      [{ requestedFileName: 'parts/old.kcl' }].map((file) =>
        normalizeKCLFileDeletePath(file.requestedFileName)
      )
    )

    expect(
      requestedFilesToDelete.has(normalizeKCLFileDeletePath('parts\\old.kcl'))
    ).toBe(true)
  })
})
