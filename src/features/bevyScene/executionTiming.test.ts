import { describe, expect, it } from 'vitest'
import { projectPushDebounceMs } from '@src/features/bevyScene/executionTiming'

describe('Bevy project execution timing', () => {
  it('submits Kclean edits at interactive latency', () => {
    expect(projectPushDebounceMs('kclean')).toBe(100)
  })

  it('retains the conservative Zoo debounce', () => {
    expect(projectPushDebounceMs('zoo')).toBe(500)
  })
})
