import {
  getEnvironmentLabel,
  isNonStandardEnvironment,
} from '@src/components/environment/utils'
import { describe, expect, it } from 'vitest'

describe('getEnvironmentLabel', () => {
  it('returns the domain when urls have no overrides', () => {
    expect(
      getEnvironmentLabel('dev.zoo.dev', [
        new URL('wss://api.dev.zoo.dev/ws/modeling/commands'),
        new URL('wss://api.dev.zoo.dev/ws/ml/copilot'),
      ])
    ).toBe('dev.zoo.dev')
  })

  it('appends local for localhost hosts', () => {
    expect(
      getEnvironmentLabel('dev.zoo.dev', [
        new URL('ws://localhost:8080/ws/modeling/commands'),
      ])
    ).toBe('dev.zoo.dev + local')
  })

  it('appends search params for non-local overrides', () => {
    expect(
      getEnvironmentLabel('dev.zoo.dev', [
        new URL('wss://api.dev.zoo.dev/ws/modeling/commands?pr=1234'),
      ])
    ).toBe('dev.zoo.dev + pr=1234')
  })
})

describe('isNonStandardEnvironment', () => {
  it('is non-standard when non-production points at zoo.dev', () => {
    expect(isNonStandardEnvironment('zoo.dev', false)).toBe(true)
  })

  it('is standard when non-production points at dev.zoo.dev', () => {
    expect(isNonStandardEnvironment('dev.zoo.dev', false)).toBe(false)
  })

  it('is non-standard when production points at dev.zoo.dev', () => {
    expect(isNonStandardEnvironment('dev.zoo.dev', true)).toBe(true)
  })

  it('is standard when production points at zoo.dev', () => {
    expect(isNonStandardEnvironment('zoo.dev', true)).toBe(false)
  })

  it('is always non-standard with preview parameters', () => {
    expect(isNonStandardEnvironment('dev.zoo.dev + pr=1234', false)).toBe(true)
    expect(isNonStandardEnvironment('zoo.dev + local', true)).toBe(true)
  })
})
