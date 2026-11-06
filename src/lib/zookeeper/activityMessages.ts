import type { MlCopilotServerMessage } from '@kittycad/lib'

export const ZOOKEEPER_ACTIVITY_PREFIX = 'zk_activity_v1:'

export type ZookeeperActivity =
  | { kind: 'commentary'; text: string }
  | {
      kind: 'tool'
      call_id: string
      name: string
      status: 'started' | 'completed'
      label?: string
      ok?: boolean
    }

export type ActivityItem =
  | ZookeeperActivity
  | { kind: 'legacy'; message: MlCopilotServerMessage }

export const parseZookeeperActivity = (
  message: MlCopilotServerMessage
): ZookeeperActivity | undefined => {
  if ('reasoning' in message === false || message.reasoning.type !== 'markdown')
    return undefined
  const content = message.reasoning.content
  if (!content.startsWith(ZOOKEEPER_ACTIVITY_PREFIX)) return undefined

  try {
    const value: unknown = JSON.parse(
      content.slice(ZOOKEEPER_ACTIVITY_PREFIX.length)
    )
    if (typeof value !== 'object' || value === null) return undefined
    if ('kind' in value && value.kind === 'commentary') {
      return 'text' in value && typeof value.text === 'string'
        ? { kind: 'commentary', text: value.text }
        : undefined
    }
    if (
      !('kind' in value && value.kind === 'tool') ||
      !('call_id' in value && typeof value.call_id === 'string') ||
      !('name' in value && typeof value.name === 'string') ||
      !(
        'status' in value &&
        (value.status === 'started' || value.status === 'completed')
      )
    )
      return undefined

    return {
      kind: 'tool',
      call_id: value.call_id,
      name: value.name,
      status: value.status,
      ...('label' in value && typeof value.label === 'string'
        ? { label: value.label }
        : {}),
      ...('ok' in value && typeof value.ok === 'boolean'
        ? { ok: value.ok }
        : {}),
    }
  } catch {
    return undefined
  }
}

export const collectActivityItems = (
  messages: MlCopilotServerMessage[]
): ActivityItem[] => {
  const items: ActivityItem[] = []
  const toolIndexes = new Map<string, number>()

  for (const message of messages) {
    const activity = parseZookeeperActivity(message)
    if (activity === undefined) {
      items.push({ kind: 'legacy', message })
    } else if (activity.kind === 'commentary') {
      items.push(activity)
    } else if (activity.status === 'started') {
      toolIndexes.set(activity.call_id, items.length)
      items.push(activity)
    } else {
      const index = toolIndexes.get(activity.call_id)
      if (index === undefined) {
        items.push(activity)
      } else {
        const started = items[index]
        items[index] =
          started.kind === 'tool' ? { ...started, ...activity } : activity
      }
    }
  }
  return items
}
