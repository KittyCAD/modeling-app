import { parseLaunchRequest } from '@src/lib/launchRequest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

describe('parseLaunchRequest', () => {
  it('captures the command and prompt together while retaining URL state', () => {
    expect(
      parseLaunchRequest(
        '?cmd=set-layout&groupId=application&layoutId=zookeeper&ttc-prompt=Make+a+cube&pool=alpha&tab=project&sort_by=name%3Aasc'
      )
    ).toEqual({
      request: {
        genericCommand: {
          name: 'set-layout',
          groupId: 'application',
          argDefaultValues: { layoutId: 'zookeeper' },
        },
        zookeeperPrompt: 'Make a cube',
        askOpenDesktop: false,
      },
      remainingSearch: '?pool=alpha&tab=project&sort_by=name%3Aasc',
    })
  })

  it.each([
    'cmd=&groupId=application',
    'cmd=set-layout&groupId=',
    'cmd=set-layout',
  ])(
    'keeps a prompt independent of malformed command controls: %s',
    (command) => {
      expect(
        parseLaunchRequest(
          `?${command}&layoutId=zookeeper&zookeeper-prompt=Cube`
        )
      ).toEqual({
        request: { zookeeperPrompt: 'Cube', askOpenDesktop: false },
        remainingSearch: '?layoutId=zookeeper',
      })
    }
  )

  it('prefers the current prompt alias and consumes both aliases', () => {
    expect(
      parseLaunchRequest('?ttc-prompt=Old&zookeeper-prompt=Current')
    ).toEqual({
      request: { zookeeperPrompt: 'Current', askOpenDesktop: false },
      remainingSearch: '',
    })
  })

  it('preserves an explicitly empty current prompt over the legacy alias', () => {
    expect(parseLaunchRequest('?ttc-prompt=Old&zookeeper-prompt=')).toEqual({
      request: undefined,
      remainingSearch: '',
    })
  })

  it('captures the desktop choice without requiring another launch action', () => {
    expect(parseLaunchRequest('?ask-open-desktop=false&pool=alpha')).toEqual({
      request: { askOpenDesktop: true },
      remainingSearch: '?pool=alpha',
    })
  })

  it('keeps shared project and legacy file data out of generic arguments', () => {
    expect(
      parseLaunchRequest(
        '?project-id=shared&create-file&name=main.kcl&code=YWJj%2B%2F%3D&cmd=set-layout&groupId=application&layoutId=ttc&ask-open-desktop'
      )
    ).toEqual({
      request: {
        genericCommand: {
          name: 'set-layout',
          groupId: 'application',
          argDefaultValues: { layoutId: 'ttc' },
        },
        createFile: { name: 'main.kcl', code: 'YWJj+/=' },
        projectId: 'shared',
        askOpenDesktop: true,
      },
      remainingSearch: '',
    })
  })

  it('supports legacy file links with no name or code', () => {
    expect(parseLaunchRequest('?create-file')).toEqual({
      request: { createFile: { code: '' }, askOpenDesktop: false },
      remainingSearch: '',
    })
  })

  it('retains auth flags instead of treating them as command arguments', () => {
    const flags =
      'immediate-sign-in-if-necessary&allow-mobile&vercel-playwright-token=test'
    const parsed = parseLaunchRequest(
      `?cmd=set-layout&groupId=application&${flags}`
    )
    expect(parsed.request?.genericCommand?.argDefaultValues).toEqual({})
    expect(new URLSearchParams(parsed.remainingSearch)).toEqual(
      new URLSearchParams(flags)
    )
  })

  it('preserves arbitrary legacy arguments, including name and code', () => {
    expect(
      parseLaunchRequest('?cmd=custom&groupId=custom&name=A&code=B&futureArg=C')
        .request?.genericCommand
    ).toEqual({
      name: 'custom',
      groupId: 'custom',
      argDefaultValues: { name: 'A', code: 'B', futureArg: 'C' },
    })
  })

  it('does not decode literal percent escapes or percent signs twice', () => {
    const parsed = parseLaunchRequest(
      '?cmd=custom&groupId=custom&literal=%252F&percent=100%25&broken=%'
    )
    expect(parsed.request?.genericCommand?.argDefaultValues).toEqual({
      literal: '%2F',
      percent: '100%',
      broken: '%',
    })
  })

  it('round-trips arbitrary command argument text through URL encoding once', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const params = new URLSearchParams({
          cmd: 'custom',
          groupId: 'custom',
          argument: value,
        })
        expect(
          parseLaunchRequest(params.toString()).request?.genericCommand
            ?.argDefaultValues.argument
        ).toBe(value)
      })
    )
  })

  it('preserves last-value semantics for repeated generic arguments', () => {
    const parsed = parseLaunchRequest(
      '?cmd=custom&groupId=custom&argument=first&argument=last'
    )
    expect(parsed.request?.genericCommand?.argDefaultValues).toEqual({
      argument: 'last',
    })
    expect(parsed.remainingSearch).toBe('')
  })

  it('leaves unrelated query state alone when there is no launch request', () => {
    expect(parseLaunchRequest('?pool=alpha&unknown=keep&name=Example')).toEqual(
      {
        request: undefined,
        remainingSearch: '?pool=alpha&unknown=keep&name=Example',
      }
    )
    expect(parseLaunchRequest('')).toEqual({
      request: undefined,
      remainingSearch: '',
    })
  })
})
