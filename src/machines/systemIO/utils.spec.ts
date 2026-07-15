import type { MlToolResult } from '@kittycad/lib'
import { StorageName, moduleFsViaModuleImport } from '@src/lib/fs-zds'
import fsZds from '@src/lib/fs-zds'
import type { ZookeeperEditPatch } from '@src/lib/zookeeper/zookeeperEditPatch'
import {
  collectProjectFiles,
  normalizeKCLFileDeletePath,
  prepareMlEphantNewFileRequest,
} from '@src/machines/systemIO/utils'
import { beforeAll, describe, expect, it } from 'vitest'

type EditKclCodeToolResultWithPatch = Extract<
  MlToolResult,
  { type: 'edit_kcl_code' }
>

type EditKclCodeToolResultWithLocalPatch = Omit<
  EditKclCodeToolResultWithPatch,
  'zookeeper_edit_patch'
> & {
  zookeeper_edit_patch: ZookeeperEditPatch
}

const asMlToolResult = (
  toolOutput: EditKclCodeToolResultWithLocalPatch
): MlToolResult => toolOutput as unknown as MlToolResult

beforeAll(async () => {
  await moduleFsViaModuleImport({
    type: StorageName.NodeFS,
    options: {},
  })
})

describe('System IO Utils', () => {
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

  it('returns forward-slash relPaths for nested files', async () => {
    // relPath becomes the `current_files` keys and `source_ranges` file paths
    // sent to the ML/Zookeeper service, which keys everything with forward
    // slashes. On Windows fsZds.relative yields backslashes, so collectProjectFiles
    // must normalize; this guards that posix invariant for nested files.
    const projectPath = `/tmp/opencode/zookeeper-project-${crypto.randomUUID()}`
    const nestedPath = fsZds.join(projectPath, 'parts', 'bracket.kcl')
    await fsZds.mkdir(fsZds.join(projectPath, 'parts'), { recursive: true })
    await fsZds.writeFile(
      fsZds.join(projectPath, 'main.kcl'),
      new TextEncoder().encode('cube()')
    )
    await fsZds.writeFile(nestedPath, new TextEncoder().encode('bracket = 1'))

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
          kcl_file_count: 2,
          directory_count: 1,
          default_file: fsZds.join(projectPath, 'main.kcl'),
          readWriteAccess: true,
        },
      })

      const relPaths = projectFiles.map((file) => file.relPath)
      expect(relPaths).toContain('parts/bracket.kcl')
      for (const relPath of relPaths) {
        expect(relPath).not.toContain('\\')
      }
    } finally {
      await fsZds.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('uses live editor contents for the selected project file after path normalization', async () => {
    const projectPath = `/tmp/opencode/zookeeper-project-${crypto.randomUUID()}`
    const mainPath = fsZds.join(projectPath, 'main.kcl')
    await fsZds.mkdir(projectPath, { recursive: true })
    await fsZds.writeFile(
      mainPath,
      new TextEncoder().encode('boxHeight = 50mm')
    )

    try {
      const projectFiles = await collectProjectFiles({
        selectedFileContents: 'boxHeight = 500mm',
        selectedFilePath: `${projectPath}${fsZds.sep}.${fsZds.sep}main.kcl`,
        fileNames: {
          0: {
            type: 'Local',
            value: mainPath,
            original_import_path: null,
          },
        },
        projectContext: {
          name: 'zookeeper-project',
          path: projectPath,
          children: [
            {
              name: 'main.kcl',
              path: mainPath,
              children: null,
            },
          ],
          metadata: null,
          kcl_file_count: 1,
          directory_count: 0,
          default_file: mainPath,
          readWriteAccess: true,
        },
      })

      const mainFile = projectFiles.find((file) => file.relPath === 'main.kcl')
      expect(mainFile).toMatchObject({
        type: 'kcl',
        fileContents: 'boxHeight = 500mm',
      })
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

  it('falls back to the active editor file as the navigation target', () => {
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fallbackFilePath: '/projects/some-project/main.kcl',
      toolOutput: {
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          'main.kcl': 'height = 400',
        },
      },
    })

    expect(preparedPayload?.requestedFileNameWithExtension).toBe('main.kcl')
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

  it('carries Zookeeper edit patch metadata into edit requests', () => {
    const zookeeperEditPatch: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        {
          path: 'main.kcl',
          status: 'modified',
          diff: '--- a/main.kcl\n+++ b/main.kcl\n@@ -1 +1 @@\n-width = 5\n+width = 10\n',
        },
        {
          path: 'old.kcl',
          status: 'deleted',
          previous_contents: 'old = true\n',
        },
      ],
    }
    const toolOutput: EditKclCodeToolResultWithLocalPatch = {
      status_code: 200,
      type: 'edit_kcl_code',
      project_name: 'some-project',
      outputs: {
        'main.kcl': 'width = 10',
      },
      zookeeper_edit_patch: zookeeperEditPatch,
    }

    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      toolOutput: asMlToolResult(toolOutput),
    })

    expect(preparedPayload?.zookeeperEditPatch).toEqual(zookeeperEditPatch)
    expect(preparedPayload?.filesToDelete).toEqual([
      { requestedFileName: 'old.kcl' },
    ])
  })

  it('does not allow Zookeeper to delete the project entrypoint', () => {
    const toolOutput: EditKclCodeToolResultWithLocalPatch = {
      status_code: 200,
      type: 'edit_kcl_code',
      project_name: 'some-project',
      outputs: { 'part.kcl': 'part = true' },
      zookeeper_edit_patch: {
        run_id: 'run-main-delete',
        changed_files: [
          {
            path: 'main.kcl',
            status: 'deleted',
            previous_contents: 'main = true',
          },
          {
            path: 'part.kcl',
            status: 'created',
            contents: 'part = true',
          },
        ],
      },
    }
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
      filesToDelete: [{ requestedFileName: './main.kcl' }],
      toolOutput: asMlToolResult(toolOutput),
    })

    expect(preparedPayload?.filesToDelete).toEqual([])
    expect(preparedPayload?.zookeeperEditPatch?.changed_files).toEqual([
      {
        path: 'part.kcl',
        status: 'created',
        contents: 'part = true',
      },
    ])
  })

  it('falls back to the project entrypoint when Zookeeper deletes the focused file', () => {
    const toolOutput: EditKclCodeToolResultWithLocalPatch = {
      status_code: 200,
      type: 'edit_kcl_code',
      project_name: 'some-project',
      outputs: { 'main.kcl': 'main = true\n' },
      zookeeper_edit_patch: {
        run_id: 'run-delete-focused-file',
        changed_files: [
          {
            path: 'part.kcl',
            status: 'deleted',
            previous_contents: 'part = true\n',
          },
        ],
      },
    }
    const preparedPayload = prepareMlEphantNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'part.kcl',
        path: '/some-project/part.kcl',
        children: null,
      },
      toolOutput: asMlToolResult(toolOutput),
    })

    expect(preparedPayload?.requestedFileNameWithExtension).toBe('main.kcl')
    expect(preparedPayload?.filesToDelete).toEqual([
      { requestedFileName: 'part.kcl' },
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
