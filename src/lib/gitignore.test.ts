import ignore from 'ignore'
import { describe, expect, it } from 'vitest'

import {
  type GitignoreStackEntry,
  isPathIgnoredByGitignore,
} from '@src/lib/gitignore'

function stackEntry(directory: string, patterns: string): GitignoreStackEntry {
  return {
    directory,
    matcher: ignore().add(patterns),
  }
}

describe('isPathIgnoredByGitignore', () => {
  it('ignores paths matched by the project root .gitignore', () => {
    const stack = [stackEntry('', 'dist\nnotes.txt\n')]

    expect(isPathIgnoredByGitignore(stack, 'dist', true)).toBe(true)
    expect(isPathIgnoredByGitignore(stack, 'dist/build.log', false)).toBe(true)
    expect(isPathIgnoredByGitignore(stack, 'notes.txt', false)).toBe(true)
    expect(isPathIgnoredByGitignore(stack, 'main.kcl', false)).toBe(false)
  })

  it('applies nested .gitignore files relative to their directory', () => {
    const stack = [
      stackEntry('', 'build'),
      stackEntry('packages', 'generated\n'),
    ]

    expect(isPathIgnoredByGitignore(stack, 'build', false)).toBe(true)
    expect(isPathIgnoredByGitignore(stack, 'packages/generated', false)).toBe(
      true
    )
    expect(
      isPathIgnoredByGitignore(stack, 'packages/generated/output.txt', false)
    ).toBe(true)
    expect(
      isPathIgnoredByGitignore(stack, 'packages/src/main.kcl', false)
    ).toBe(false)
  })

  it('does not apply nested rules to paths outside their directory', () => {
    const stack = [stackEntry('packages', 'generated\n')]

    expect(isPathIgnoredByGitignore(stack, 'generated', false)).toBe(false)
    expect(isPathIgnoredByGitignore(stack, 'other/generated', false)).toBe(
      false
    )
  })
})
