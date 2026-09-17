import { onboardingOverlayContribution } from '@src/registry/extensions/onboarding/overlay'
import { settingsOverlayContribution } from '@src/registry/extensions/settings/overlay'
import { telemetryOverlayContribution } from '@src/registry/extensions/telemetry/overlay'
import { describe, expect, it } from 'vitest'
import { parseInitialUrl } from './initialUrl'

const overlays = [
  settingsOverlayContribution,
  telemetryOverlayContribution,
  onboardingOverlayContribution,
]

describe('parseInitialUrl', () => {
  it('parses a project target and its capability-owned settings overlay', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/file/%2Fprojects%2Fbracket/settings?tab=project#modeling.defaultUnit',
        { overlays, usesHashRouter: false }
      )
    ).toEqual({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      overlay: {
        contributionId: 'settings',
        state: { tab: 'project', setting: 'modeling.defaultUnit' },
      },
      search: '?tab=project',
      hash: '#modeling.defaultUnit',
    })
  })

  it('parses the application portion of a desktop hash URL', () => {
    expect(
      parseInitialUrl(
        'file:///Applications/Zoo.app/index.html#/file/%2Fprojects%2Fbracket/telemetry?pool=alpha',
        { overlays, usesHashRouter: true }
      )
    ).toEqual({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      overlay: {
        contributionId: 'telemetry',
        state: { type: 'telemetry' },
      },
      search: '?pool=alpha',
      hash: '',
    })
  })

  it('parses a selected library as home state', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/library/cloud%3Apersonal/settings?tab=user',
        { overlays, usesHashRouter: false }
      )
    ).toMatchObject({
      type: 'launch',
      destination: { type: 'home', libraryId: 'cloud:personal' },
      overlay: {
        contributionId: 'settings',
        state: { tab: 'user' },
      },
    })
  })

  it('lets onboarding own and parse its step type', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/file/%2Fprojects%2Fbracket/onboarding/desktop/scene',
        { overlays, usesHashRouter: false }
      )
    ).toMatchObject({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      overlay: {
        contributionId: 'onboarding',
        state: { step: '/desktop/scene' },
      },
    })
  })

  it('keeps auth as the owner of sign-in rather than making it an overlay', () => {
    expect(
      parseInitialUrl('https://app.zoo.dev/signin?callback=desktop', {
        overlays,
        usesHashRouter: false,
      })
    ).toEqual({
      type: 'launch',
      destination: { type: 'sign-in' },
      search: '?callback=desktop',
      hash: '',
    })
  })

  it('returns an unrecognized datatype for unknown child paths', () => {
    expect(
      parseInitialUrl('https://app.zoo.dev/home/not-a-real-overlay', {
        overlays,
        usesHashRouter: false,
      })
    ).toEqual({
      type: 'unrecognized',
      pathname: '/home/not-a-real-overlay',
      search: '',
      hash: '',
    })
  })
})

describe('overlay URL projections', () => {
  it('keeps each capability responsible for its own URL shape', () => {
    expect(
      settingsOverlayContribution.format({
        tab: 'keybindings',
        setting: 'editor.textWrapping',
      })
    ).toEqual({
      path: '/settings',
      search: '?tab=keybindings',
      hash: '#editor.textWrapping',
    })
    expect(telemetryOverlayContribution.format({ type: 'telemetry' })).toEqual({
      path: '/telemetry',
    })
    expect(
      onboardingOverlayContribution.format({ step: '/desktop/scene' })
    ).toEqual({ path: '/onboarding/desktop/scene' })
  })
})
