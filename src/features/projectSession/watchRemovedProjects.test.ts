import { computed, signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import type { LibraryLoadState } from '@src/contracts/projectLibraries'
import { watchRemovedProjects } from '@src/features/projectSession/watchRemovedProjects'

function harness(options: { opened?: string[]; paths?: string[] } = {}) {
  const paths = signal<readonly string[]>(options.paths ?? ['/a', '/b'])
  const state = signal<LibraryLoadState>('ready')
  const opened = new Set(options.opened ?? ['/a'])
  const announced: string[] = []

  const stop = watchRemovedProjects({
    paths: computed(() => paths.value),
    state: computed(() => state.value),
    opened: () => opened,
    // Mirrors the real caller, which drops the path as it announces.
    announce: (path) => {
      opened.delete(path)
      announced.push(path)
    },
  })

  return { paths, state, opened, announced, stop }
}

describe('noticing a removed project', () => {
  it('says nothing while everything it had open is still there', () => {
    const { announced, stop } = harness()

    expect(announced).toEqual([])
    stop()
  })

  it('announces a project that has disappeared', () => {
    const { paths, announced, stop } = harness()

    paths.value = ['/b']

    expect(announced).toEqual(['/a'])
    stop()
  })

  it('ignores projects it never had open', () => {
    const { paths, announced, stop } = harness({ opened: ['/a'] })

    paths.value = ['/a']

    // `/b` went, but nothing was holding anything for it.
    expect(announced).toEqual([])
    stop()
  })

  /*
   * The guard that matters most. `realizations` is empty in the middle of a
   * rescan, and announcing then would tell every listener to discard work for
   * every project a moment before they all come back.
   */
  it('says nothing when the list is transiently empty', () => {
    const { paths, announced, stop } = harness()

    paths.value = []

    expect(announced).toEqual([])
    stop()
  })

  it('says nothing while the libraries are still scanning', () => {
    const { paths, state, announced, stop } = harness()

    state.value = 'scanning'
    paths.value = ['/b']

    expect(announced).toEqual([])

    // And catches up once the scan settles.
    state.value = 'ready'
    expect(announced).toEqual(['/a'])
    stop()
  })

  it('says nothing when the libraries failed to load', () => {
    const { paths, state, announced, stop } = harness()

    state.value = 'error'
    paths.value = ['/b']

    expect(announced).toEqual([])
    stop()
  })

  it('announces each project once', () => {
    const { paths, announced, stop } = harness({ opened: ['/a', '/b'] })

    paths.value = ['/c']
    paths.value = ['/c', '/d']

    expect(announced).toEqual(['/a', '/b'])
    stop()
  })

  it('stops watching once stopped', () => {
    const { paths, announced, stop } = harness()

    stop()
    paths.value = ['/b']

    expect(announced).toEqual([])
  })
})
