import { onboardingNavigationUrlContribution } from '@src/registry/extensions/onboarding/overlay'
import { settingsNavigationUrlContribution } from '@src/registry/extensions/settings/overlay'
import { telemetryNavigationUrlContribution } from '@src/registry/extensions/telemetry/overlay'
import { describe, expect, it } from 'vitest'
import { formatAppUrl, parseInitialUrl } from './initialUrl'

const navigationIntents = [
  settingsNavigationUrlContribution,
  telemetryNavigationUrlContribution,
  onboardingNavigationUrlContribution,
]

describe('parseInitialUrl', () => {
  it('parses a project target and its capability-owned settings overlay', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/file/%2Fprojects%2Fbracket/settings?tab=project#modeling.defaultUnit',
        { navigationIntents, usesHashRouter: false }
      )
    ).toEqual({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      additionalIntents: [
        {
          intent: { id: 'settings.open', placement: 'additional' },
          input: { tab: 'project', setting: 'modeling.defaultUnit' },
        },
      ],
      search: '?tab=project',
      hash: '#modeling.defaultUnit',
    })
  })

  it('parses the application portion of a desktop hash URL', () => {
    expect(
      parseInitialUrl(
        'file:///Applications/Zoo.app/index.html#/file/%2Fprojects%2Fbracket/telemetry?pool=alpha',
        { navigationIntents, usesHashRouter: true }
      )
    ).toEqual({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      additionalIntents: [
        {
          intent: { id: 'telemetry.open', placement: 'additional' },
          input: { type: 'telemetry' },
        },
      ],
      search: '?pool=alpha',
      hash: '',
    })
  })

  it('parses a selected library as home state', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/library/cloud%3Apersonal/settings?tab=user',
        { navigationIntents, usesHashRouter: false }
      )
    ).toMatchObject({
      type: 'launch',
      destination: { type: 'home', libraryId: 'cloud:personal' },
      additionalIntents: [
        { intent: { id: 'settings.open' }, input: { tab: 'user' } },
      ],
    })
  })

  it('lets onboarding own and parse its step type', () => {
    expect(
      parseInitialUrl(
        'https://app.zoo.dev/file/%2Fprojects%2Fbracket/onboarding/desktop/scene',
        { navigationIntents, usesHashRouter: false }
      )
    ).toMatchObject({
      type: 'launch',
      destination: { type: 'project', target: '/projects/bracket' },
      additionalIntents: [
        {
          intent: { id: 'onboarding.start' },
          input: { step: '/desktop/scene' },
        },
      ],
    })
  })

  it('keeps auth as the owner of sign-in rather than making it an overlay', () => {
    expect(
      parseInitialUrl('https://app.zoo.dev/signin?callback=desktop', {
        navigationIntents,
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
        navigationIntents,
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

describe('navigation intent URL projections', () => {
  it('formats a canonical project target with structured startup state', () => {
    expect(
      formatAppUrl(
        {
          destination: {
            type: 'project',
            target: '/projects/bracket/main.kcl',
          },
          search: '?pool=alpha',
          hash: '',
        },
        navigationIntents
      )
    ).toBe('/file/%2Fprojects%2Fbracket%2Fmain.kcl?pool=alpha')
  })

  it('lets an additional intent project its capability-owned URL fields', () => {
    expect(
      formatAppUrl(
        {
          destination: { type: 'project', target: '/projects/bracket' },
          additionalIntents: [
            {
              intent: { id: 'settings.open', placement: 'additional' },
              input: {
                tab: 'keybindings',
                setting: 'editor.textWrapping',
              },
            },
          ],
          search: '?discarded=by-overlay',
          hash: '#discarded-by-overlay',
        },
        navigationIntents
      )
    ).toBe(
      '/file/%2Fprojects%2Fbracket/settings?tab=keybindings#editor.textWrapping'
    )
  })

  it('keeps each capability responsible for its own URL shape', () => {
    expect(
      settingsNavigationUrlContribution.format({
        tab: 'keybindings',
        setting: 'editor.textWrapping',
      })
    ).toEqual({
      path: '/settings',
      search: '?tab=keybindings',
      hash: '#editor.textWrapping',
    })
    expect(
      telemetryNavigationUrlContribution.format({ type: 'telemetry' })
    ).toEqual({ path: '/telemetry' })
    expect(
      onboardingNavigationUrlContribution.format({ step: '/desktop/scene' })
    ).toEqual({ path: '/onboarding/desktop/scene' })
  })
})
