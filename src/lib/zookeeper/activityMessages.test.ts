import type { MlCopilotServerMessage } from '@kittycad/lib'
import {
  collectActivityItems,
  parseZookeeperActivity,
  ZOOKEEPER_ACTIVITY_PREFIX,
} from '@src/lib/zookeeper/activityMessages'
import { describe, expect, test } from 'vitest'

const message = (payload: object, native: boolean): MlCopilotServerMessage =>
  native
    ? { activity: payload }
    : {
        reasoning: {
          type: 'markdown',
          content: ZOOKEEPER_ACTIVITY_PREFIX + JSON.stringify(payload),
        },
      }

describe('Zookeeper activity messages', () => {
  test.each([false, true])('merges tool updates (native: %s)', (native) => {
    const activity = (payload: object) => message(payload, native)
    const items = collectActivityItems([
      activity({ kind: 'commentary', text: 'Checking the project.' }),
      activity({
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'started',
        label: 'Read main.kcl',
        arguments: '{"path":"main.kcl"}',
      }),
      activity({ kind: 'commentary', text: 'The file exists.' }),
      activity({
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'completed',
        output: 'File contents',
        ok: true,
      }),
      activity({ kind: 'warning', text: 'One attachment was ignored.' }),
    ])

    expect(items).toEqual([
      { kind: 'commentary', text: 'Checking the project.' },
      {
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'completed',
        label: 'Read main.kcl',
        ok: true,
      },
      { kind: 'commentary', text: 'The file exists.' },
      { kind: 'warning', text: 'One attachment was ignored.' },
    ])
  })

  test('leaves malformed and legacy reasoning messages available to old rendering', () => {
    const malformed: MlCopilotServerMessage = {
      reasoning: { type: 'markdown', content: ZOOKEEPER_ACTIVITY_PREFIX + '{' },
    }
    const legacy: MlCopilotServerMessage = {
      reasoning: { type: 'markdown', content: 'Thinking through the model.' },
    }

    expect(parseZookeeperActivity(malformed)).toBeUndefined()
    expect(collectActivityItems([malformed, legacy])).toEqual([
      { kind: 'legacy', message: malformed },
      { kind: 'legacy', message: legacy },
    ])
  })
})
