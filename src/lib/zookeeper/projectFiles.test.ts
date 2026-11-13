import { posix } from '@chainner/node-path'
import type { MlToolResult } from '@kittycad/lib'
import { normalizeKCLFileDeletePath } from '@src/lib/projectSession/projectFiles'
import { prepareZookeeperNewFileRequest } from '@src/lib/zookeeper/projectFiles'
import type { ZookeeperEditPatch } from '@src/lib/zookeeper/zookeeperEditPatch'
import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

// Patch preparation needs path semantics but performs no filesystem I/O.
vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('@chainner/node-path')).posix,
}))

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

describe('Zookeeper project edit request preparation', () => {
  it('preserves generated nested filenames and source contents in authorized new-file requests', () => {
    const path = fc
      .array(fc.constantFrom('parts', 'café', '空', '..hidden'), {
        maxLength: 4,
      })
      .map((parts) => posix.join(...parts, 'main.kcl'))
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            path,
            contents: fc.oneof(
              fc.string(),
              fc.constant('@settings(kclVersion = 3.0)\n// café 空\n')
            ),
          }),
          { selector: (file) => file.path, minLength: 1, maxLength: 12 }
        ),
        (files) => {
          const prepared = prepareZookeeperNewFileRequest({
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
              zookeeper_edit_patch: {
                run_id: 'new-files',
                changed_files: files.map((file) => ({
                  path: file.path,
                  status: 'created' as const,
                  contents: 'patch contents are not the output source',
                })),
              },
              outputs: Object.fromEntries(
                files.map((file) => [file.path, file.contents])
              ),
            },
          })
          expect(prepared?.files).toHaveLength(files.length)
          expect(
            new Map(
              prepared?.files.map((file) => [
                file.requestedFileName,
                file.requestedCode,
              ])
            )
          ).toEqual(new Map(files.map((file) => [file.path, file.contents])))
          for (const file of prepared?.files ?? [])
            expect(file.requestedProjectName).toBe('some-project')
        }
      )
    )
  })

  it('preserves files by default when preparing Zookeeper edit requests', () => {
    const preparedPayload = prepareZookeeperNewFileRequest({
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
        zookeeper_edit_patch: {
          run_id: 'run-edit',
          changed_files: [{ path: 'main.kcl', status: 'modified', diff: '' }],
        },
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

  it('writes only created and modified outputs listed in the edit patch', () => {
    const prepared = prepareZookeeperNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      toolOutput: asMlToolResult({
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          'main.kcl': 'width = 10',
          'parts/new.kcl': 'height = 20',
          'parts/untouched.kcl': 'length = 30',
          'old.kcl': 'stale output for a deleted file',
        },
        zookeeper_edit_patch: {
          run_id: 'run-filter',
          changed_files: [
            { path: 'main.kcl', status: 'modified', diff: '' },
            {
              path: 'parts/new.kcl',
              status: 'created',
              contents: 'height = 20',
            },
            {
              path: 'old.kcl',
              status: 'deleted',
              previous_contents: 'old = 1',
            },
            {
              path: 'missing-output.kcl',
              status: 'created',
              contents: 'height = 99',
            },
          ],
        },
      }),
    })
    expect(prepared?.files).toEqual([
      {
        requestedProjectName: 'some-project',
        requestedFileName: 'main.kcl',
        requestedCode: 'width = 10',
      },
      {
        requestedProjectName: 'some-project',
        requestedFileName: 'parts/new.kcl',
        requestedCode: 'height = 20',
      },
    ])
    expect(prepared?.filesToDelete).toEqual([{ requestedFileName: 'old.kcl' }])
  })

  it('matches normalized patch paths while preserving dotfile names', () => {
    const prepared = prepareZookeeperNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      toolOutput: asMlToolResult({
        status_code: 200,
        type: 'edit_kcl_code',
        project_name: 'some-project',
        outputs: {
          './parts\\bracket.kcl': 'width = 10',
          '.gitignore': '*.stl',
          'untouched.kcl': 'height = 20',
        },
        zookeeper_edit_patch: {
          run_id: 'run-path-normalization',
          changed_files: [
            { path: 'parts/bracket.kcl', status: 'modified', diff: '' },
            { path: './.gitignore', status: 'created', contents: '*.stl' },
          ],
        },
      }),
    })
    expect(prepared?.files.map((file) => file.requestedFileName)).toEqual([
      'parts/bracket.kcl',
      '.gitignore',
    ])
  })

  it.each([
    undefined,
    null,
    { run_id: 'no-list' },
    { run_id: 'empty-list', changed_files: [] },
  ])(
    'does not write outputs without explicit changed-file entries (%j)',
    (patch) => {
      const prepared = prepareZookeeperNewFileRequest({
        projectNameCurrentlyOpened: 'some-project',
        toolOutput: {
          type: 'edit_kcl_code',
          status_code: 200,
          project_name: 'some-project',
          outputs: { 'main.kcl': 'width = 10' },
          zookeeper_edit_patch: patch,
        } as MlToolResult,
      })
      expect(prepared?.files).toEqual([])
      expect(prepared?.filesToDelete).toEqual([])
    }
  )

  it('keeps the currently focused file as the navigation target after project-wide edits', () => {
    const preparedPayload = prepareZookeeperNewFileRequest({
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
    const preparedPayload = prepareZookeeperNewFileRequest({
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

  it('carries only deleted entries from the Zookeeper edit patch into edit requests', () => {
    const preparedPayload = prepareZookeeperNewFileRequest({
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
        zookeeper_edit_patch: {
          run_id: 'run-delete',
          changed_files: [
            {
              path: 'old.kcl',
              status: 'deleted',
              previous_contents: 'old = 1',
            },
            {
              path: 'notes.txt',
              status: 'deleted',
              previous_contents: 'old notes',
            },
            { path: 'main.kcl', status: 'modified', diff: '' },
            { path: 'new.kcl', status: 'created', contents: 'new = 1' },
          ],
        },
      },
    })

    expect(preparedPayload?.filesToDelete).toEqual([
      { requestedFileName: 'old.kcl' },
      { requestedFileName: 'notes.txt' },
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

    const preparedPayload = prepareZookeeperNewFileRequest({
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
    const preparedPayload = prepareZookeeperNewFileRequest({
      projectNameCurrentlyOpened: 'some-project',
      fileFocusedOnInEditor: {
        name: 'main.kcl',
        path: '/some-project/main.kcl',
        children: null,
      },
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
    const preparedPayload = prepareZookeeperNewFileRequest({
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
    expect(
      requestedFilesToDelete.has(normalizeKCLFileDeletePath('parts/keep.kcl'))
    ).toBe(false)
    expect(
      requestedFilesToDelete.has(normalizeKCLFileDeletePath('other/old.kcl'))
    ).toBe(false)
  })
})
