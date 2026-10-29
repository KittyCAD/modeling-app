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
  if (
    !isRecord(message) ||
    !isRecord(message.tool_output) ||
    !isRecord(message.tool_output.result)
  )
    return
  const result = message.tool_output.result
  if (
    typeof result.type !== 'string' ||
    typeof result.call_id !== 'string' ||
    !result.call_id ||
    result.ok !== true ||
    result.error != null ||
    typeof result.project_id !== 'string'
  )
    return
  if (!mutations.has(result.type)) return
  const metadata = projectMetadata(result.output)
  if (typeof metadata?.id !== 'string' || !metadata.id) return
  if (result.project_id !== `cloud:${metadata.id}`) return
  return { callId: result.call_id, projectId: metadata.id }
}
