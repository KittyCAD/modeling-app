import { describe, expect, it } from 'vitest'
import { createWriteClaims } from '@src/lib/collab/claims'

const A = 'writer-a'
const B = 'writer-b'
const PATH = 'main.kcl'

describe('createWriteClaims', () => {
  it('grants an unclaimed path', () => {
    const claims = createWriteClaims()

    expect(claims.claim(PATH, A)).toBe(true)
    expect(claims.holder(PATH)).toBe(A)
  })

  it('reports nobody holding a path it has never seen', () => {
    expect(createWriteClaims().holder(PATH)).toBeNull()
  })

  /**
   * A writer sends several outputs per turn and each one asks again, so
   * re-claiming what you already hold has to be ordinary rather than an error.
   */
  it('grants a path the same writer already holds', () => {
    const claims = createWriteClaims()
    claims.claim(PATH, A)

    expect(claims.claim(PATH, A)).toBe(true)
  })

  it('refuses a path another writer holds', () => {
    const claims = createWriteClaims()
    claims.claim(PATH, A)

    expect(claims.claim(PATH, B)).toBe(false)
    expect(claims.holder(PATH)).toBe(A)
  })

  it('lets a different path be claimed by somebody else', () => {
    const claims = createWriteClaims()
    claims.claim('main.kcl', A)

    expect(claims.claim('lid.kcl', B)).toBe(true)
  })

  it('frees a path when its holder releases it', () => {
    const claims = createWriteClaims()
    claims.claim(PATH, A)

    expect(claims.releasePath(PATH, A)).toBe(true)
    expect(claims.holder(PATH)).toBeNull()
    expect(claims.claim(PATH, B)).toBe(true)
  })

  it('refuses to release a path somebody else holds', () => {
    const claims = createWriteClaims()
    claims.claim(PATH, A)

    expect(claims.releasePath(PATH, B)).toBe(false)
    expect(claims.holder(PATH)).toBe(A)
  })

  it('releases everything one writer holds at the end of its turn', () => {
    const claims = createWriteClaims()
    claims.claim('main.kcl', A)
    claims.claim('lid.kcl', A)
    claims.claim('other.kcl', B)

    expect([...claims.release(A)].sort()).toEqual(['lid.kcl', 'main.kcl'])
    expect(claims.holder('main.kcl')).toBeNull()
    // B's claim is untouched.
    expect(claims.holder('other.kcl')).toBe(B)
  })

  it('releases nothing for a writer holding nothing', () => {
    const claims = createWriteClaims()
    claims.claim(PATH, A)

    expect(claims.release(B)).toEqual([])
  })

  /**
   * The UI renders "Zookeeper (2) is waiting for main.kcl", which has to stop
   * being true the moment the first writer finishes.
   */
  it('publishes its claims reactively', () => {
    const claims = createWriteClaims()

    expect(claims.held.value.size).toBe(0)

    claims.claim(PATH, A)
    expect(claims.held.value.get(PATH)).toBe(A)

    claims.release(A)
    expect(claims.held.value.size).toBe(0)
  })
})
