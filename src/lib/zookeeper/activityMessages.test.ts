import type { MlCopilotServerMessage } from '@kittycad/lib'
import {
  collectActivityItems,
  parseZookeeperActivity,
  ZOOKEEPER_ACTIVITY_PREFIX,
} from '@src/lib/zookeeper/activityMessages'
import { describe, expect, test } from 'vitest'

const message = (payload: object): MlCopilotServerMessage => ({
  reasoning: {
    type: 'markdown',
    content: ZOOKEEPER_ACTIVITY_PREFIX + JSON.stringify(payload),
  },
})

describe('Zookeeper activity messages', () => {
  test('keeps commentary in order and merges tool completion into its start row', () => {
    const items = collectActivityItems([
      message({ kind: 'commentary', text: 'Checking the project.' }),
      message({
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'started',
        arguments: '{"path":"main.kcl"}',
      }),
      message({ kind: 'commentary', text: 'The file exists.' }),
      message({
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'completed',
        output: 'File contents',
        ok: true,
      }),
    ])

    expect(items).toEqual([
      { kind: 'commentary', text: 'Checking the project.' },
      {
        kind: 'tool',
        call_id: 'call-1',
        name: 'read_project_file',
        status: 'completed',
        arguments: '{"path":"main.kcl"}',
        output: 'File contents',
        ok: true,
      },
      { kind: 'commentary', text: 'The file exists.' },
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
