import { parseCloudProjectToolChange } from '@src/lib/zookeeper/cloudProjectTools'
import { describe, expect, it } from 'vitest'

const result = (
  tool_name: string,
  output: unknown = { id: 'one', revision: '2' }
) => ({
  zookeeper_recovery_tool_output: {
    call_id: 'call-1',
    tool_name,
    output: JSON.stringify(output),
    project_updated: false,
  },
})

describe('cloud MCP mutation returns', () => {
  it.each([
    'project_write_file',
    'project_mkdir',
    'project_rm',
    'project_cp',
    'project_mv',
    'mcp__zoo-cloud__project_mv',
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
  it('ignores tool errors, truncated results, and malformed metadata', () => {
    for (const output of [
      { isError: true, id: 'one', revision: '2' },
      { error: 'Failed' },
      { id: 'one', revision: null },
    ])
      expect(
        parseCloudProjectToolChange(result('project_rm', output))
      ).toBeUndefined()
    const message = result('project_rm')
    expect(
      parseCloudProjectToolChange({
        zookeeper_recovery_tool_output: {
          ...message.zookeeper_recovery_tool_output,
          output_truncated: true,
        },
      })
    ).toBeUndefined()
    expect(
      parseCloudProjectToolChange({
        zookeeper_recovery_tool_output: {
          ...message.zookeeper_recovery_tool_output,
          output: 'not json',
        },
      })
    ).toBeUndefined()
  })
})
