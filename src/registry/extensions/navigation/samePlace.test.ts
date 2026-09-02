import { samePlace } from '@src/registry/extensions/navigation/samePlace'
import { describe, expect, test } from 'vitest'

/**
 * A trailing slash is not a place.
 *
 * The real case, from a Playwright run: the suite navigates to
 * `/file/<id>/?cmd=app.theme&groupId=settings` and the derived path has no
 * trailing slash. Same route to React Router, same screen to the user. Without
 * this the app would rewrite the URL purely to delete a slash — a history entry
 * that changes nothing — and the drift detector would report it as a real
 * disagreement.
 */
describe('samePlace', () => {
  test.each([
    ['/file/x?cmd=y', '/file/x/?cmd=y', true],
    ['/home', '/home/', true],
    ['/home', '/home', true],
    ['/', '/', true],
    ['/file/x?a=1', '/file/y?a=1', false],
    ['/file/x', '/file/x?a=1', false],
    ['/home', '/library/x', false],
  ])('%s vs %s -> %s', (a, b, expected) => {
    expect(samePlace(a, b)).toBe(expected)
    // Whatever it decides, it has to decide the same way round.
    expect(samePlace(b, a)).toBe(expected)
  })
})
