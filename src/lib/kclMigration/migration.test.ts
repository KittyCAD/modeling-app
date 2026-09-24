import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
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

async function review() {
  await fixture.controller.start(true)
  await vi.waitFor(() => expect(fixture.controller.phase.value).toBe('running'))
  fixture.send(successfulOperation(fixture.request))
  await vi.waitFor(() => expect(fixture.controller.phase.value).toBe('review'))
}

describe('project migration', () => {
  it('keeps nested and binary files, overlays unsaved text and validates paths', async () => {
    await writeFile(path.join(fixture.root, '._meta'), '{"mtimeMs":1}')
    const captured = await fixture.project.capture()
    expect([...captured.files.keys()]).toEqual([
      'asset.bin',
      'main.kcl',
      'parts/part.kcl',
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

  it('rejects linked files and directories rather than uploading files outside the project', async () => {
    await symlink(fixture.root, path.join(fixture.root, 'linked-project'))
    await expect(fixture.project.capture()).rejects.toThrow('symbolic links')
  })

  it('requires consent, authenticates, stages without writing, applies and restores all original bytes', async () => {
    await fixture.controller.start(false)
    expect(fixture.frames).toEqual([])
    await review()
    expect(fixture.frames[0]).toEqual({
      type: 'headers',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(await fixture.readMain()).toBe(sourceCode)
    const original = fixture.controller.original.value?.files
    await fixture.controller.apply()
    expect(fixture.controller.phase.value).toBe('applied')
    expect(await fixture.readMain()).toBe(targetCode)
    await fixture.controller.undo()
    expect(fixture.controller.phase.value).toBe('idle')
    expect(await fixture.readMain()).toBe(sourceCode)
    expect(
      await readProjectFiles(fixture.runtime.operations, path, fixture.root)
    ).toEqual(original)
  })

  it.each(['edit', 'add', 'delete'])(
    'rejects a stale candidate after a project %s',
    async (change) => {
      await review()
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
      await fixture.controller.apply()
      expect(fixture.controller.phase.value).toBe('failed')
      expect(fixture.controller.detail.value).toContain('changed')
      expect(
        await readProjectFiles(fixture.runtime.operations, path, fixture.root)
      ).toEqual(before)
    }
  )

  it('guards Undo against subsequent user edits', async () => {
    await review()
    await fixture.controller.apply()
    await writeFile(
      path.join(fixture.root, 'main.kcl'),
      `${targetCode}newValue = 42\n`
    )
    await fixture.controller.undo()
    expect(fixture.controller.phase.value).toBe('applied')
    expect(fixture.controller.detail.value).toContain('changed')
    expect(await fixture.readMain()).toContain('newValue = 42')
  })

  it('cancels and discards a success that races cancellation', async () => {
    await fixture.controller.start(true)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('running')
    )
    fixture.controller.cancel()
    await vi.waitFor(() =>
      expect(fixture.frames.some((f) => f.type === 'cancel')).toBe(true)
    )
    fixture.send(successfulOperation(fixture.request))
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('cancelled')
    )
    expect(fixture.controller.candidate.value).toBeUndefined()
    expect(await fixture.readMain()).toBe(sourceCode)
  })

  it('queries status after disconnect without starting another operation', async () => {
    await fixture.controller.start(true)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('running')
    )
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
      expect(fixture.controller.phase.value).toBe('review')
    )
    expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
  })

  it('ignores a late capture from an older cancelled attempt', async () => {
    const snapshot = await fixture.project.capture()
    let finish: (value: typeof snapshot) => void = () => {}
    const pending = new Promise<typeof snapshot>((resolve) => {
      finish = resolve
    })
    let captures = 0
    const controller = new MigrationController(
      {
        ...fixture.project,
        capture: () => (++captures === 1 ? pending : Promise.resolve(snapshot)),
      },
      () => 'token'
    )
    try {
      const old = controller.start(true)
      controller.cancel()
      await controller.start(true)
      await vi.waitFor(() => expect(controller.phase.value).toBe('running'))
      const requestId = fixture.request.request_id
      finish(snapshot)
      await old
      expect(fixture.frames.filter((f) => f.type === 'start')).toHaveLength(1)
      expect(fixture.request.request_id).toBe(requestId)
    } finally {
      controller.dispose()
    }
  })

  it('rejects a result for another snapshot and never applies after leaving the project', async () => {
    await fixture.controller.start(true)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('running')
    )
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
    await review()
    fixture.leaveProject()
    await fixture.controller.apply()
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
      await fixture.controller.start(true)
      await vi.waitFor(() =>
        expect(fixture.controller.phase.value).toBe('running')
      )
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
      expect(fixture.controller.candidate.value).toBeUndefined()
      expect(await fixture.readMain()).toBe(sourceCode)
    }
  )

  it('requires complete validation and refuses missing files or altered binary assets', async () => {
    await fixture.controller.start(true)
    await vi.waitFor(() =>
      expect(fixture.controller.phase.value).toBe('running')
    )
    const operation = successfulOperation(fixture.request)
    if (!operation.result?.validation)
      throw new Error('Missing test validation')
    operation.result.validation.geometry_preserved = false
    expect(
      parseMigrationMessage({ type: 'operation', operation })
    ).toBeInstanceOf(Error)
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
