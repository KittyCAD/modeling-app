import { REGEXP_UUIDV4 } from '@src/lib/constants'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'

const ZOOKEEPER_CONVERSATIONS_FILE_NAME = 'ml-conversations.json'

export type ZookeeperConversations = Map<string, string>

export interface ZookeeperConversationStore {
  getProjectConversationId: (projectId: string) => Promise<string | undefined>
  saveProjectConversationId: (args: {
    projectId: string
    conversationId: string
  }) => Promise<void>
  deleteProjectConversationId: (projectId: string) => Promise<void>
}

export const jsonToZookeeperConversations = (
  json: string
): ZookeeperConversations => {
  const conversations = new Map<string, string>()
  const untypedObject = JSON.parse(json)
  for (const entry of Object.entries(untypedObject)) {
    if (typeof entry[0] === 'string' && !REGEXP_UUIDV4.test(entry[0])) {
      console.warn(
        'Expected a project id string as a key (potentially bad format)'
      )
      continue
    }
    if (typeof entry[1] === 'string' && !REGEXP_UUIDV4.test(entry[1])) {
      console.warn('Expected a conversation id string (potentially bad format)')
      continue
    }

    if (typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      conversations.set(entry[0], entry[1])
    }
  }
  return conversations
}

export const zookeeperConversationsToJson = (
  conversations: ZookeeperConversations
): string => {
  return JSON.stringify(Object.fromEntries(conversations))
}

const getZookeeperConversationsFilePath = async () =>
  fsZds.join(
    fsZds.dirname(await getAppSettingsFilePath()),
    ZOOKEEPER_CONVERSATIONS_FILE_NAME
  )

const readZookeeperConversations =
  async (): Promise<ZookeeperConversations> => {
    try {
      const json = await fsZds.readFile(
        await getZookeeperConversationsFilePath(),
        {
          encoding: 'utf-8',
        }
      )
      return jsonToZookeeperConversations(json ?? '')
    } catch (error) {
      console.warn('Cannot get Zookeeper conversations', error)
      return new Map()
    }
  }

const writeZookeeperConversations = async (
  conversations: ZookeeperConversations
) => {
  const te = new TextEncoder()
  await fsZds.writeFile(
    await getZookeeperConversationsFilePath(),
    te.encode(zookeeperConversationsToJson(conversations))
  )
}

let pendingOperation = Promise.resolve<unknown>(undefined)

const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pendingOperation.then(operation, operation)
  pendingOperation = result.catch(() => undefined)
  return result
}

export const zookeeperConversationStore: ZookeeperConversationStore = {
  getProjectConversationId(projectId) {
    return serialize(async () =>
      (await readZookeeperConversations()).get(projectId)
    )
  },
  saveProjectConversationId({ projectId, conversationId }) {
    return serialize(async () => {
      const conversations = await readZookeeperConversations()
      conversations.set(projectId, conversationId)
      await writeZookeeperConversations(conversations)
    })
  },
  deleteProjectConversationId(projectId) {
    return serialize(async () => {
      const conversations = await readZookeeperConversations()
      conversations.delete(projectId)
      await writeZookeeperConversations(conversations)
    })
  },
}
