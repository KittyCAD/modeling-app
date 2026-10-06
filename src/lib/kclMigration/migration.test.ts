import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  MigrationRecoveryError,
  replaceMigrationFiles,
} from '@src/lib/kclMigration/apply'
import { MigrationController } from '@src/lib/kclMigration/controller'
import {
  type MigrationOperation,
  parseMigrationMessage,
} from '@src/lib/kclMigration/protocol'
import {
  candidateFiles,
  equalFiles,
  readProjectFiles,
  validProjectPath,
  withEditorBuffers,
} from '@src/lib/kclMigration/snapshot'
import {
  migrationFixture,
  sourceCode,
  successfulOperation,
  targetCode,
} from '@src/lib/kclMigration/testHelpers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let fixture: Awaited<ReturnType<typeof migrationFixture>>
beforeEach(async () => {
  fixture = await migrationFixture()
})
afterEach(async () => {
  await fixture.dispose()
})

async function startRunning() {
  await fixture.controller.start()
  await vi.waitFor(() => expect(fixture.controller.phase.value).toBe('running'))
}

describe('project migration', () => {
  it('streams progress only for this attempt without applying candidate edits', async () => {
    await startRunning()
    expect(fixture.frames).toContainEqual({
      type: 'start',
      request: fixture.request,
    })
    fixture.sendMessage({
      type: 'progress',
      operation_id: 'another-attempt',
      message: { info: { text: 'Unrelated' } },
    })
    fixture.sendMessage({
      type: 'progress',
      operation_id: fixture.request.request_id,
      message: {
        reasoning: {
          type: 'markdown',
          content: 'Comparing the original views.',
        },
      },
    })
    fixture.sendMessage({
      type: 'progress',
      operation_id: fixture.request.request_id,
      message: { delta: { delta: 'Checking ' } },
    })
    fixture.sendMessage({
      type: 'progress',
      operation_id: fixture.request.request_id,
      message: { delta: { delta: 'geometry.' } },
    })
    await vi.waitFor(() =>
      expect(fixture.controller.progressText.value).toBe('Checking geometry.')
    )
    expect(fixture.controller.progress.value).toEqual([
      {
        reasoning: {
          type: 'markdown',
          content: 'Comparing the original views.',
        },
      },
    ])
    expect(await fixture.readMain()).toBe(sourceCode)
    fixture.send(successfulOperation(fixture.request))
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('applied')
    )
    expect(fixture.controller.progress.value).toHaveLength(1)
    expect(await fixture.readMain()).toBe(targetCode)
    await fixture.controller.start()
    expect(fixture.controller.phase.value).toBe('applied')
    expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
  })

  it.each([true, false, undefined])(
    'reports quota exemption only with confirmed evidence (%s)',
    async (conversionNotStarted) => {
      await startRunning()
      fixture.send({
        ...successfulOperation(fixture.request),
        status: 'failed',
        result: {
          status: 'failed',
          files: {},
          detail: 'Migration failed.',
          conversion_not_started: conversionNotStarted,
        },
      })
      await vi.waitFor(() =>
        expect(fixture.controller.phase.value).toBe('failed')
      )
      expect(fixture.controller.detail.value.includes('did not count')).toBe(
        conversionNotStarted === true
      )
      expect(await fixture.readMain()).toBe(sourceCode)
    }
  )

  it('keeps nested and binary files, overlays unsaved text and validates paths', async () => {
    await writeFile(path.join(fixture.root, '._meta'), '{"mtimeMs":1}')
    await writeFile(
      path.join(fixture.root, 'thumbnail.png'),
      'generated preview'
    )
    await writeFile(
      path.join(fixture.root, 'parts', 'thumbnail.png'),
      'project asset'
    )
    const captured = await fixture.project.capture()
    expect([...captured.files.keys()]).toEqual([
      'asset.bin',
      'main.kcl',
      'parts/part.kcl',
      'parts/thumbnail.png',
    ])
    const overlaid = withEditorBuffers(
      captured.files,
      new Map([['main.kcl', `${sourceCode}unsaved = 2\n`]])
    )
    expect(overlaid).toBeInstanceOf(Map)
    if (overlaid instanceof Error) throw overlaid
    expect(new TextDecoder().decode(overlaid.get('main.kcl'))).toContain(
      'unsaved = 2'
    )
    expect(overlaid.get('asset.bin')).toEqual(new Uint8Array([0, 255, 128, 1]))
    expect(await fixture.readMain()).toBe(sourceCode)
    for (const name of [
      '../secret',
      'a/../secret',
      '/absolute',
      'C:\\file',
      'a//file',
      './main.kcl',
    ])
      expect(validProjectPath(name)).toBe(false)
    expect(
      withEditorBuffers(captured.files, new Map([['missing.kcl', 'x = 1']]))
    ).toBeInstanceOf(Error)
    await writeFile(
      path.join(fixture.root, 'oversized.bin'),
      new Uint8Array(8 * 1024 * 1024)
    )
    await expect(fixture.project.capture()).rejects.toThrow('8 MiB')
  })

  it('preserves distinct filenames that differ only by case', async ({
    skip,
  }) => {
    await writeFile(path.join(fixture.root, 'Main.kcl'), 'upper = 1\n')
    const names = await readdir(fixture.root)
    if (!names.includes('main.kcl') || !names.includes('Main.kcl')) {
      skip()
    }
    const { files } = await fixture.project.capture()
    expect(new TextDecoder().decode(files.get('main.kcl'))).toBe(sourceCode)
    expect(new TextDecoder().decode(files.get('Main.kcl'))).toBe('upper = 1\n')
  })

  it('rejects linked files and directories rather than uploading files outside the project', async () => {
    await symlink(fixture.root, path.join(fixture.root, 'linked-project'))
    await expect(fixture.project.capture()).rejects.toThrow('symbolic links')
  })

  it('requests KCL 3 preview with opt-in, authenticates and applies only after a validated result', async () => {
    await startRunning()
    expect(fixture.request.target).toBe('3.0-preview')
    expect(fixture.request.allow_preview).toBe(true)
    expect(fixture.frames[0]).toEqual({
      type: 'headers',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(await fixture.readMain()).toBe(sourceCode)
    fixture.send(successfulOperation(fixture.request))
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('applied')
    )
    expect(await fixture.readMain()).toBe(targetCode)
  })

  it.each(['edit', 'add', 'delete'])(
    'rejects a stale candidate after a project %s',
    async (change) => {
      await startRunning()
      if (change === 'edit')
        await writeFile(
          path.join(fixture.root, 'main.kcl'),
          `${sourceCode}later = 1\n`
        )
      if (change === 'add')
        await writeFile(path.join(fixture.root, 'new.kcl'), 'newValue = 1')
      if (change === 'delete')
        await fixture.runtime.operations.remove(
          path.join(fixture.root, 'asset.bin')
        )
      const before = await readProjectFiles(
        fixture.runtime.operations,
        path,
        fixture.root
      )
      fixture.send(successfulOperation(fixture.request))
      await vi.waitFor(() =>
        expect(fixture.controller.phase.value).toBe('failed')
      )
      expect(fixture.controller.detail.value).toContain('changed')
      expect(
        await readProjectFiles(fixture.runtime.operations, path, fixture.root)
      ).toEqual(before)
    }
  )

  it('cancels and discards a success that races cancellation', async () => {
    await startRunning()
    fixture.controller.cancel()
    await vi.waitFor(() =>
      expect(fixture.frames.some((f) => f.type === 'cancel')).toBe(true)
    )
    fixture.send(successfulOperation(fixture.request))
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('cancelled')
    )
    expect(await fixture.readMain()).toBe(sourceCode)
  })

  it('queries status after disconnect without starting another operation', async () => {
    await startRunning()
    fixture.disconnect()
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('disconnected')
    )
    await fixture.controller.recover()
    await vi.waitFor(() =>
      expect(fixture.frames.some((f) => f.type === 'status')).toBe(true)
    )
    fixture.send(successfulOperation(fixture.request))
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('applied')
    )
    expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
  })

  it('ignores a late capture from an older cancelled attempt', async () => {
    const snapshot = await fixture.project.capture()
    let finish: (value: typeof snapshot) => void = () => {}
    const pending = new Promise<typeof snapshot>((resolve) => {
      finish = resolve
    })
    const controller = new MigrationController(
      {
        ...fixture.project,
        capture: () => pending,
      },
      () => 'token'
    )
    try {
      const old = controller.start()
      controller.cancel()
      await startRunning()
      const requestId = fixture.request.request_id
      finish(snapshot)
      await old
      expect(controller.phase.value).toBe('cancelled')
      expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
      expect(fixture.request.request_id).toBe(requestId)
    } finally {
      controller.dispose()
    }
  })

  it('rejects a result for another snapshot', async () => {
    await startRunning()
    const operation = successfulOperation(fixture.request)
    operation.project_snapshot = {
      ...operation.project_snapshot,
      snapshot_id: 'different',
    }
    fixture.send(operation)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('failed')
    )
    expect(fixture.controller.detail.value).toContain(
      'different project or attempt'
    )
  })

  it('never applies after leaving the project', async () => {
    await startRunning()
    fixture.leaveProject()
    fixture.controller.dispose()
    fixture.send(successfulOperation(fixture.request))
    expect(await fixture.readMain()).toBe(sourceCode)
  })

  const terminalFailures: MigrationOperation['status'][] = [
    'failed',
    'timed_out',
    'unsupported',
    'validation_failed',
    'cancelled',
  ]
  it.each(terminalFailures)(
    'keeps original files for a %s result',
    async (status) => {
      await startRunning()
      fixture.send({
        ...successfulOperation(fixture.request),
        status,
        result: {
          status,
          detail: 'The worker could not migrate this project.',
          files: {},
        },
      })
      await vi.waitFor(() =>
        expect(fixture.controller.phase.value).toBe(
          status === 'cancelled' ? 'cancelled' : 'failed'
        )
      )
      expect(await fixture.readMain()).toBe(sourceCode)
      const phase = fixture.controller.phase.value
      await fixture.controller.start()
      expect(fixture.controller.phase.value).toBe(phase)
      expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
    }
  )

  it('requires complete validation and refuses missing files or altered binary assets', async () => {
    await startRunning()
    const operation = successfulOperation(fixture.request)
    if (!operation.result?.validation)
      throw new Error('Missing test validation')
    operation.result.validation.geometry_preserved = false
    expect(
      parseMigrationMessage({ type: 'operation', operation })
    ).toBeInstanceOf(Error)
    fixture.send(operation)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('failed')
    )
    expect(await fixture.readMain()).toBe(sourceCode)
    const original = (await fixture.project.capture()).files
    expect(candidateFiles(original, {})).toBeInstanceOf(Error)
    expect(
      candidateFiles(original, {
        ...fixture.request.current_files,
        'asset.bin': [1],
      })
    ).toBeInstanceOf(Error)
    expect(
      candidateFiles(original, {
        ...fixture.request.current_files,
        'main.kcl': [255],
      })
    ).toBeInstanceOf(Error)
  })

  it('restores completed writes when a later real filesystem write fails', async () => {
    const expected = (await fixture.project.capture()).files
    const replacement = new Map(expected)
    replacement.set('main.kcl', new TextEncoder().encode(targetCode))
    replacement.set('parts/part.kcl', new TextEncoder().encode('changed = 1'))
    await expect(
      fixture.runtime.operations.withDirectoryLock(
        fixture.root,
        async (files) =>
          replaceMigrationFiles({
            files: {
              ...files,
              writeFile: async (name, bytes) => {
                // Force a real ENOTDIR after the first successful write.
                if (name.endsWith('part.kcl'))
                  await writeFile(
                    path.join(fixture.root, 'main.kcl', 'impossible'),
                    bytes
                  )
                else await files.writeFile(name, bytes)
              },
            },
            paths: path,
            root: fixture.root,
            expected,
            replacement,
            isCurrent: () => true,
          })
      )
    ).rejects.toThrow()
    expect(
      equalFiles(
        await readProjectFiles(fixture.runtime.operations, path, fixture.root),
        expected
      )
    ).toBe(true)
  })

  it('retains backups when an external edit prevents rollback', async () => {
    const expected = (await fixture.project.capture()).files
    const replacement = new Map(expected)
    replacement.set('main.kcl', new TextEncoder().encode(targetCode))
    replacement.set('parts/part.kcl', new TextEncoder().encode('changed = 1'))
    await expect(
      fixture.runtime.operations.withDirectoryLock(
        fixture.root,
        async (files) =>
          replaceMigrationFiles({
            files: {
              ...files,
              writeFile: async (name, bytes) => {
                if (name.endsWith('part.kcl')) {
                  await writeFile(
                    path.join(fixture.root, 'main.kcl'),
                    'external = 123'
                  )
                  await mkdir(path.join(fixture.root, 'main.kcl', 'impossible'))
                } else await files.writeFile(name, bytes)
              },
            },
            paths: path,
            root: fixture.root,
            expected,
            replacement,
            isCurrent: () => true,
          })
      )
    ).rejects.toBeInstanceOf(MigrationRecoveryError)
    expect(await fixture.readMain()).toBe('external = 123')
  })

  it('holds the project lock through the entire batch, including recovery', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const batch = fixture.runtime.operations.withDirectoryLock(
      fixture.root,
      async (files) => {
        await files.writeFile(
          path.join(fixture.root, 'main.kcl'),
          new TextEncoder().encode(targetCode)
        )
        entered()
        await gate
        await files.writeFile(
          path.join(fixture.root, 'main.kcl'),
          new TextEncoder().encode(sourceCode)
        )
      }
    )
    await ready
    let readFinished = false
    const queued = fixture.runtime.operations
      .readFile(path.join(fixture.root, 'main.kcl'))
      .then((bytes) => {
        readFinished = true
        return bytes
      })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readFinished).toBe(false)
    release()
    await batch
    expect(new TextDecoder().decode(await queued)).toBe(sourceCode)
    expect(await readFile(path.join(fixture.root, 'main.kcl'), 'utf8')).toBe(
      sourceCode
    )
  })
})
