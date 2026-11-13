import { describe, expect, test } from 'vitest'
import {
  getDesktopHandoffUrl,
  shouldShowDesktopHandoff,
} from '@src/lib/browserHandoff'

describe('desktop handoff URLs', () => {
  test.each([
    '?ask-open-desktop',
    '?ask-open-desktop=',
    '?ask-open-desktop=false',
  ])('ASK presence, not its value, controls the web chooser: %s', (search) => {
    expect(shouldShowDesktopHandoff(search, false)).toBe(true)
    expect(shouldShowDesktopHandoff(search, true)).toBe(false)
  })

  test('normal web and desktop links bypass the chooser', () => {
    expect(shouldShowDesktopHandoff('?code=abc', false)).toBe(false)
    expect(shouldShowDesktopHandoff('?code=abc', true)).toBe(false)
  })

  test('desktop protocol retains the complete path, query, and fragment', () => {
    const url = new URL(
      'https://app.zoo.dev/file/my%20project?project-id=p&code=a%2Bb%3D&ask-open-desktop=false#details'
    )
    expect(getDesktopHandoffUrl(url)).toBe(
      'zoo-studio://file/my%20project?project-id=p&code=a%2Bb%3D&ask-open-desktop=false#details'
    )
  })
})
