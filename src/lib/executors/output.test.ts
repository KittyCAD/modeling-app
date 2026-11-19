import { createExecutorOutput } from '@src/lib/executors/output'
import { defineExecutorCapability } from '@src/lib/executors/registry/contract'
import { expect, expectTypeOf, it } from 'vitest'

const snapshot = { src: 'notes.md', contents: 'hello', running: false }

it('infers sync and async data, preserving literal IDs and excluding returned errors', () => {
  const markdown = defineExecutorCapability({
    id: 'markdown.render',
    matches: '.md',
    execute: (contents) => ({ html: contents }),
  })
  const count = defineExecutorCapability({
    id: 'count',
    matches: '*',
    execute: async (contents) =>
      contents ? { count: contents.length } : new Error('Empty contents'),
  })
  const output = createExecutorOutput(snapshot, [
    [markdown, { html: 'hello' }],
    [count, { count: 5 }],
  ])
  expectTypeOf(markdown.id).toEqualTypeOf<'markdown.render'>()
  expectTypeOf(output.get(markdown)).toEqualTypeOf<
    { html: string } | undefined
  >()
  expectTypeOf(output.get(count)).toEqualTypeOf<{ count: number } | undefined>()
  expect(output.get(markdown)).toEqual({ html: 'hello' })
  expect(output.get(count)).toEqual({ count: 5 })
})

it('does not confuse different capabilities that have the same ID', () => {
  const first = defineExecutorCapability({
    id: 'shared',
    matches: '*',
    execute: () => ({ html: 'first' }),
  })
  const replacement = defineExecutorCapability({
    id: 'shared',
    matches: '*',
    execute: () => ({ count: 42 }),
  })
  const original = createExecutorOutput(snapshot, [[first, { html: 'first' }]])
  const updated = createExecutorOutput(snapshot, [[replacement, { count: 42 }]])
  expect(original.get(replacement)).toBeUndefined()
  expect(updated.get(first)).toBeUndefined()
  expect(original.get(first)).toEqual({ html: 'first' })
  expect(updated.get(replacement)).toEqual({ count: 42 })
})

it('returns undefined for pending, absent and failed results while retaining error summaries', () => {
  const failed = defineExecutorCapability({
    id: 'failure',
    matches: '*',
    execute: () => new Error('Failed'),
  })
  const error = new Error('Failed')
  const pending = createExecutorOutput({ ...snapshot, running: true })
  const finished = createExecutorOutput(snapshot, [[failed, error]])
  expectTypeOf(finished.get(failed)).toEqualTypeOf<undefined>()
  expect(pending.get(failed)).toBeUndefined()
  expect(finished.get(failed)).toBeUndefined()
  expect(finished.data).toEqual({})
  expect(finished.errors).toEqual({ failure: error })
})
