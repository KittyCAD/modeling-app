import {
  effectiveRenderer,
  kcleanServerSetting,
} from '@src/features/bevyScene/settings'
import { describe, expect, it } from 'vitest'

describe('effectiveRenderer', () => {
  it('preserves either renderer for the Zoo engine', () => {
    expect(effectiveRenderer('zoo', 'engine')).toBe('engine')
    expect(effectiveRenderer('zoo', 'bevy')).toBe('bevy')
  })

  it('requires Bevy for Kclean', () => {
    expect(effectiveRenderer('kclean', 'engine')).toBe('bevy')
    expect(effectiveRenderer('kclean', 'bevy')).toBe('bevy')
  })
})

describe('kcleanServerSetting', () => {
  it('parses HTTP base URLs and rejects other schemes', () => {
    expect(kcleanServerSetting.parse('http://127.0.0.1:3001')).toBe(
      'http://127.0.0.1:3001'
    )
    expect(kcleanServerSetting.parse('https://kclean.example.test/')).toBe(
      'https://kclean.example.test/'
    )
    expect(kcleanServerSetting.parse('file:///tmp/kclean.sock')).toBeUndefined()
  })
})
