import { parseCloudProjectToolChange } from '@src/lib/zookeeper/cloudProjectTools'
import { describe, expect, it } from 'vitest'

const result = (
  type: string,
  output: unknown = { id: 'one', revision: '2' }
) => ({
  tool_output: {
    result: {
      call_id: 'call-1',
      type,
      project_id: 'cloud:one',
      ok: true,
      output,
    },
  },
})

describe('cloud MCP mutation returns', () => {
  it.each([
    'project_write_file',
    'project_mkdir',
    'project_rm',
    'project_cp',
    'project_mv',
  ])('refreshes after an acknowledged %s result', (name) => {
    expect(parseCloudProjectToolChange(result(name))).toEqual({
      callId: 'call-1',
      projectId: 'one',
    })
  })
  it('reads the MCP structured and text result envelopes', () => {
    for (const output of [
      { structuredContent: { id: 'one', revision: '2' } },
      {
        content: [
          { type: 'text', text: JSON.stringify({ id: 'one', revision: '2' }) },
        ],
      },
    ])
      expect(
        parseCloudProjectToolChange(result('project_write_file', output))
          ?.projectId
      ).toBe('one')
  })
  it.each([
    'project_read_file',
    'project_readdir',
    'project_stat',
    'project_access',
    'edit_project_file',
    'unrelated__project_rm',
  ])('ignores %s', (name) =>
    expect(parseCloudProjectToolChange(result(name))).toBeUndefined()
  )
  it('ignores failed calls, wrong projects, and malformed metadata', () => {
    for (const output of [
      { isError: true, id: 'one', revision: '2' },
      { error: 'Failed' },
      { id: 'one', revision: null },
      { id: 'other', revision: '2' },
    ])
      expect(
        parseCloudProjectToolChange(result('project_rm', output))
      ).toBeUndefined()
    const message = result('project_rm')
    for (const fields of [
      { ok: false },
      { error: 'Revision conflict' },
      { call_id: '' },
      { project_id: 'cloud:other' },
      { project_id: 'local:one' },
    ])
      expect(
        parseCloudProjectToolChange({
          tool_output: { result: { ...message.tool_output.result, ...fields } },
        })
      ).toBeUndefined()
  })
  it('does not use internal recovery messages as public tool responses', () => {
    expect(
      parseCloudProjectToolChange({
        zookeeper_recovery_tool_output: {
          call_id: 'call-1',
          tool_name: 'project_write_file',
          output: JSON.stringify({ id: 'one', revision: '2' }),
          project_updated: true,
        },
      })
    ).toBeUndefined()
  })
})
