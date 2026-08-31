import type { MlToolResult, ZookeeperEditPatch } from '@kittycad/lib'
import { describe, expect, it } from 'vitest'
import {
  deriveChanges,
  manifestOf,
  outputsOf,
  toolResultFailed,
} from '@src/features/zookeeper/deriveEdit'

const baselineOf = (files: Record<string, string>) =>
  new Map(Object.entries(files))

describe('deriveChanges', () => {
  it('reports a changed file as a modification', () => {
    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'main.kcl': 'width = 24\n' },
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      kind: 'modify',
      path: 'main.kcl',
    })
  })

  it('reports a path it has never seen as a creation', () => {
    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'bracket.kcl': 'depth = 2\n' },
    })

    expect(result.changes).toEqual([
      { kind: 'create', path: 'bracket.kcl', contents: 'depth = 2\n' },
    ])
  })

  /**
   * The service reports the resulting state of every file it considered, so
   * unchanged files arrive with every turn. `main` wrote those back regardless,
   * which is where its spurious dirty buffers come from.
   */
  it('drops a file whose contents did not change', () => {
    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'main.kcl': 'width = 10\n' },
    })

    expect(result.changes).toEqual([])
  })

  it('cannot know about deletions without a manifest', () => {
    const result = deriveChanges({
      baseline: baselineOf({
        'main.kcl': 'width = 10\n',
        'gone.kcl': 'x = 1\n',
      }),
      outputs: { 'main.kcl': 'width = 24\n' },
    })

    // `gone.kcl` is absent from outputs, which means either unchanged or deleted.
    expect(result.deletionsUnknowable).toBe(true)
    expect(result.changes.map((change) => change.path)).toEqual(['main.kcl'])
  })

  it('deletes a file the manifest says was deleted', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'deleted', path: 'gone.kcl', previous_contents: 'x = 1\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'gone.kcl': 'x = 1\n' }),
      outputs: {},
      manifest,
    })

    expect(result.changes).toEqual([
      { kind: 'delete', path: 'gone.kcl', previousContents: 'x = 1\n' },
    ])
    expect(result.deletionsUnknowable).toBe(false)
  })

  /**
   * The agent is describing a document we do not have. Honouring the deletion
   * would destroy contents it never read.
   */
  it('refuses a deletion whose previous contents disagree with ours', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'deleted', path: 'gone.kcl', previous_contents: 'x = 1\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'gone.kcl': 'something else entirely\n' }),
      outputs: {},
      manifest,
    })

    expect(result.changes).toEqual([])
    expect(result.refused).toEqual([
      { path: 'gone.kcl', reason: 'deletedContentsDiffer' },
    ])
  })

  it('ignores a deletion of a path it does not hold', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'deleted', path: 'never.kcl', previous_contents: 'x = 1\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({}),
      outputs: {},
      manifest,
    })

    expect(result.changes).toEqual([])
    expect(result.refused).toEqual([])
  })

  it('takes created contents from the manifest rather than outputs', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'created', path: 'new.kcl', contents: 'depth = 2\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({}),
      outputs: {},
      manifest,
    })

    expect(result.changes).toEqual([
      { kind: 'create', path: 'new.kcl', contents: 'depth = 2\n' },
    ])
  })

  /**
   * `modified` carries only a diff, which is deliberately never parsed — so
   * without contents in `outputs` there is nothing to act on.
   */
  it('refuses a modification with no contents anywhere', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'modified', path: 'main.kcl', diff: '@@ -1 +1 @@\n-a\n+b\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: {},
      manifest,
    })

    expect(result.changes).toEqual([])
    expect(result.refused).toEqual([
      { path: 'main.kcl', reason: 'noContentForModify' },
    ])
  })

  /**
   * The agent's copy of the project and ours can disagree. Ours is the one being
   * edited, so whether this is a create or a modify is our question to answer.
   */
  it('treats a manifest creation of a file we already hold as a modification', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'created', path: 'main.kcl', contents: 'width = 24\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: {},
      manifest,
    })

    expect(result.changes[0]).toMatchObject({
      kind: 'modify',
      path: 'main.kcl',
    })
  })

  it('does not process a manifest path twice when outputs also lists it', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'modified', path: 'main.kcl', diff: 'ignored' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'main.kcl': 'width = 24\n' },
      manifest,
    })

    expect(result.changes).toHaveLength(1)
  })

  it('still handles outputs the manifest did not mention', () => {
    const manifest: ZookeeperEditPatch = {
      run_id: 'run-1',
      changed_files: [
        { status: 'created', path: 'new.kcl', contents: 'depth = 2\n' },
      ],
    }

    const result = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'main.kcl': 'width = 24\n' },
      manifest,
    })

    expect(result.changes.map((change) => change.path).sort()).toEqual([
      'main.kcl',
      'new.kcl',
    ])
  })

  /**
   * The live-apply case that would otherwise double-apply. Once the first output
   * has landed, the baseline advances to it, so the second output is a statement
   * about what changed *since* — not since the start of the turn.
   */
  it('describes only what changed since the last output it saw', () => {
    const first = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\n' }),
      outputs: { 'main.kcl': 'width = 10\ndepth = 2\n' },
    })
    expect(first.changes).toHaveLength(1)

    // The caller advances the baseline to what it just applied.
    const second = deriveChanges({
      baseline: baselineOf({ 'main.kcl': 'width = 10\ndepth = 2\n' }),
      outputs: { 'main.kcl': 'width = 10\ndepth = 2\nheight = 4\n' },
    })

    expect(second.changes).toHaveLength(1)
    const change = second.changes[0]
    expect(change.kind).toBe('modify')
    if (change.kind !== 'modify') return
    // Only the appended line, not a rewrite of the first output's work.
    expect(change.edits).toHaveLength(1)
    expect(change.edits[0].insert).toContain('height = 4')
  })
})

describe('toolResultFailed', () => {
  const base = { status_code: 200, outputs: {} } as const

  it('accepts a successful edit', () => {
    const result: MlToolResult = { ...base, type: 'edit_kcl_code' }
    expect(toolResultFailed(result)).toBe(false)
  })

  it('rejects a result carrying an error', () => {
    const result: MlToolResult = {
      ...base,
      type: 'edit_kcl_code',
      error: 'the model gave up',
    }
    expect(toolResultFailed(result)).toBe(true)
  })

  it('treats an empty error string as no error', () => {
    const result: MlToolResult = { ...base, type: 'edit_kcl_code', error: '' }
    expect(toolResultFailed(result)).toBe(false)
  })

  it('rejects an HTTP-shaped failure status', () => {
    const result: MlToolResult = {
      type: 'edit_kcl_code',
      status_code: 500,
      outputs: {},
    }
    expect(toolResultFailed(result)).toBe(true)
  })

  it('never fails a knowledge-base answer, which carries no outputs', () => {
    const result: MlToolResult = {
      type: 'mechanical_knowledge_base',
      response: 'steel is stiffer than aluminium',
    }
    expect(toolResultFailed(result)).toBe(false)
  })
})

describe('outputsOf and manifestOf', () => {
  it('finds outputs on a text-to-cad result', () => {
    const result: MlToolResult = {
      type: 'text_to_cad',
      status_code: 200,
      outputs: { 'main.kcl': 'width = 10\n' },
    }
    expect(outputsOf(result)).toEqual({ 'main.kcl': 'width = 10\n' })
    // Only `edit_kcl_code` can carry a manifest, so text-to-cad cannot delete.
    expect(manifestOf(result)).toBeUndefined()
  })

  it('finds no outputs on a knowledge-base answer', () => {
    const result: MlToolResult = {
      type: 'mechanical_knowledge_base',
      response: 'prose',
    }
    expect(outputsOf(result)).toEqual({})
    expect(manifestOf(result)).toBeUndefined()
  })

  it('finds the manifest on an edit result that has one', () => {
    const manifest: ZookeeperEditPatch = { run_id: 'run-1' }
    const result: MlToolResult = {
      type: 'edit_kcl_code',
      status_code: 200,
      outputs: {},
      zookeeper_edit_patch: manifest,
    }
    expect(manifestOf(result)).toBe(manifest)
  })
})
