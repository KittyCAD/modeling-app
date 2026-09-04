import { REGEXP_UUIDV4 } from '@src/lib/constants'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

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
  for (let entry of Object.entries(untypedObject)) {
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

const readZookeeperConversations = async (
  fileOperations: FileOperationsRegistryService
): Promise<ZookeeperConversations> => {
  try {
    const json = new TextDecoder().decode(
      await fileOperations.readFile(await getZookeeperConversationsFilePath())
    )
    return jsonToZookeeperConversations(json ?? '')
  } catch (error) {
    console.warn('Cannot get Zookeeper conversations', error)
    return new Map()
  }
}

const writeZookeeperConversations = async (
  fileOperations: FileOperationsRegistryService,
  conversations: ZookeeperConversations
) => {
  await fileOperations.writeFile(
    await getZookeeperConversationsFilePath(),
    zookeeperConversationsToJson(conversations)
  )
}

export const makeZookeeperConversationStore = (
  fileOperations: FileOperationsRegistryService
): ZookeeperConversationStore => ({
  async getProjectConversationId(projectId) {
    return (await readZookeeperConversations(fileOperations)).get(projectId)
  },
  async saveProjectConversationId({ projectId, conversationId }) {
    const conversations = await readZookeeperConversations(fileOperations)
    conversations.set(projectId, conversationId)
    await writeZookeeperConversations(fileOperations, conversations)
  },
  async deleteProjectConversationId(projectId) {
    const conversations = await readZookeeperConversations(fileOperations)
    conversations.delete(projectId)
    await writeZookeeperConversations(fileOperations, conversations)
  },
})
