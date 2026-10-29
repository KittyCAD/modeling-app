import { isArray, isRecord } from '@src/lib/utils'

export interface CloudProjectToolChange {
  callId: string
  projectId: string
}

const mutations = new Set([
  'project_write_file',
  'project_mkdir',
  'project_rm',
  'project_cp',
  'project_mv',
])

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function projectMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.isError === true) return
  if (
    typeof value.id === 'string' &&
    (typeof value.revision === 'string' || typeof value.revision === 'number')
  )
    return value
  if (isRecord(value.structuredContent))
    return projectMetadata(value.structuredContent)
  if (isArray(value.content)) {
    for (const block of value.content) {
      if (
        isRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        const metadata = projectMetadata(parseJson(block.text))
        if (metadata) return metadata
      }
    }
  }
}

/** MCP mutations return acknowledged Project metadata, including its identity. */
export function parseCloudProjectToolChange(
  message: unknown
): CloudProjectToolChange | undefined {
  if (!isRecord(message) || !isRecord(message.zookeeper_recovery_tool_output))
    return
  const result = message.zookeeper_recovery_tool_output
  if (
    typeof result.tool_name !== 'string' ||
    typeof result.call_id !== 'string' ||
    !result.call_id ||
    typeof result.output !== 'string' ||
    result.output_truncated === true
  )
    return
  const name = result.tool_name.replace(/^mcp__zoo[-_]cloud__/, '')
  if (!mutations.has(name)) return
  const metadata = projectMetadata(parseJson(result.output))
  if (typeof metadata?.id !== 'string' || !metadata.id) return
  return { callId: result.call_id, projectId: metadata.id }
}
