import type { ReasoningMessage } from '@kittycad/lib'
import { describe, expect, it } from 'vitest'
import type { ReasoningEntry } from '@src/contracts/zookeeper'
import {
  appendReasoning,
  describeReasoning,
  reasoningEntryFrom,
  reasoningHeadline,
} from '@src/features/zookeeper/reasoning'

describe('reasoningEntryFrom', () => {
  it('keeps text and markdown as the same kind', () => {
    expect(
      reasoningEntryFrom({ type: 'text', content: 'Considering' })
    ).toEqual({ kind: 'text', content: 'Considering' })
    expect(
      reasoningEntryFrom({ type: 'markdown', content: '**bold**' })
    ).toEqual({ kind: 'text', content: '**bold**' })
  })

  /**
   * The one arm that names files *before* they change, which is the only honest
   * mid-turn answer to "which file is it working on".
   */
  it('reads a design plan into paths and instructions', () => {
    const entry = reasoningEntryFrom({
      type: 'design_plan',
      steps: [
        { filepath_to_edit: 'main.kcl', edit_instructions: 'Thicken the wall' },
        { filepath_to_edit: 'lid.kcl', edit_instructions: 'Match the wall' },
      ],
    })

    expect(entry).toEqual({
      kind: 'plan',
      steps: [
        { path: 'main.kcl', instructions: 'Thicken the wall' },
        { path: 'lid.kcl', instructions: 'Match the wall' },
      ],
    })
  })

  it('reads generated code and errors', () => {
    expect(
      reasoningEntryFrom({ type: 'generated_kcl_code', code: 'width = 20' })
    ).toEqual({ kind: 'code', content: 'width = 20' })
    expect(
      reasoningEntryFrom({ type: 'kcl_code_error', error: 'unknown name' })
    ).toEqual({ kind: 'error', message: 'unknown name' })
  })

  /** Six kinds for fifteen arms: the file events collapse onto three actions. */
  it('collapses every file event onto created, updated or deleted', () => {
    const cases: [ReasoningMessage, ReasoningEntry][] = [
      [
        { type: 'created_kcl_file', file_name: 'a.kcl', content: '' },
        { kind: 'file', action: 'created', path: 'a.kcl' },
      ],
      [
        { type: 'updated_kcl_file', file_name: 'b.kcl', content: '' },
        { kind: 'file', action: 'updated', path: 'b.kcl' },
      ],
      [
        { type: 'deleted_kcl_file', file_name: 'c.kcl' },
        { kind: 'file', action: 'deleted', path: 'c.kcl' },
      ],
      [
        { type: 'created_project_file', file_name: 'd.toml', content: '' },
        { kind: 'file', action: 'created', path: 'd.toml' },
      ],
      [
        { type: 'updated_project_file', file_name: 'e.toml', content: '' },
        { kind: 'file', action: 'updated', path: 'e.toml' },
      ],
      [
        { type: 'deleted_project_file', file_name: 'f.toml' },
        { kind: 'file', action: 'deleted', path: 'f.toml' },
      ],
    ]

    for (const [message, expected] of cases) {
      expect(reasoningEntryFrom(message)).toEqual(expected)
    }
  })

  it('labels the three things it can consult', () => {
    expect(reasoningEntryFrom({ type: 'kcl_docs', content: 'docs' })).toEqual({
      kind: 'reference',
      label: 'KCL documentation',
      content: 'docs',
    })
    expect(
      reasoningEntryFrom({ type: 'kcl_code_examples', content: 'x' })
    ).toEqual({ kind: 'reference', label: 'KCL examples', content: 'x' })
    expect(
      reasoningEntryFrom({ type: 'feature_tree_outline', content: 'tree' })
    ).toEqual({ kind: 'reference', label: 'Feature tree', content: 'tree' })
  })

  /** A heartbeat, not a thought — rendering it puts a hole in the explanation. */
  it('drops empty content', () => {
    expect(reasoningEntryFrom({ type: 'text', content: '' })).toBeNull()
    expect(reasoningEntryFrom({ type: 'kcl_docs', content: '' })).toBeNull()
    expect(reasoningEntryFrom({ type: 'design_plan', steps: [] })).toBeNull()
  })

  /**
   * The protocol gains reasoning kinds faster than a client ships. A turn that
   * edits files correctly must not fail because it explained itself in a way
   * this build has not been taught.
   */
  it('ignores an arm it does not know', () => {
    const future = { type: 'something_new', content: 'x' } as unknown

    expect(reasoningEntryFrom(future as ReasoningMessage)).toBeNull()
  })
})

describe('appendReasoning', () => {
  /** Prose streams in chunks; one entry per chunk is forty fragments. */
  it('joins adjacent text', () => {
    let entries: readonly ReasoningEntry[] = []
    entries = appendReasoning(entries, { kind: 'text', content: 'Thinking ' })
    entries = appendReasoning(entries, { kind: 'text', content: 'about it.' })

    expect(entries).toEqual([{ kind: 'text', content: 'Thinking about it.' }])
  })

  /**
   * But only *adjacent* text. Something in between means the service moved on
   * and came back, which is a real boundary in its working.
   */
  it('starts a new paragraph after something else happened', () => {
    let entries: readonly ReasoningEntry[] = []
    entries = appendReasoning(entries, { kind: 'text', content: 'First' })
    entries = appendReasoning(entries, {
      kind: 'file',
      action: 'updated',
      path: 'main.kcl',
    })
    entries = appendReasoning(entries, { kind: 'text', content: 'Second' })

    expect(entries.map((each) => each.kind)).toEqual(['text', 'file', 'text'])
  })
})

describe('the collapsed summary', () => {
  it('names what is happening while the turn runs', () => {
    const entries: ReasoningEntry[] = [
      { kind: 'text', content: 'Thinking' },
      { kind: 'reference', label: 'KCL documentation', content: 'x' },
    ]

    expect(reasoningHeadline(entries, true)).toBe('Reading kcl documentation')
  })

  it('counts the steps once it is over', () => {
    const entries: ReasoningEntry[] = [
      { kind: 'text', content: 'Thinking' },
      { kind: 'code', content: 'width = 1' },
    ]

    expect(reasoningHeadline(entries, false)).toBe('Working — 2 steps')
    expect(reasoningHeadline([entries[0]], false)).toBe('Working — 1 step')
  })

  it('describes a plan by how many files it covers', () => {
    expect(
      describeReasoning({
        kind: 'plan',
        steps: [{ path: 'main.kcl', instructions: 'x' }],
      })
    ).toBe('Planning 1 file')
    expect(
      describeReasoning({
        kind: 'plan',
        steps: [
          { path: 'main.kcl', instructions: 'x' },
          { path: 'lid.kcl', instructions: 'y' },
        ],
      })
    ).toBe('Planning 2 files')
  })

  it('names the file for a file event', () => {
    expect(
      describeReasoning({ kind: 'file', action: 'deleted', path: 'old.kcl' })
    ).toBe('Deleted old.kcl')
  })
})
