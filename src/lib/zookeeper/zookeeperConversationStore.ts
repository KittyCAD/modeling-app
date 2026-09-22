import { PROJECT_SETTINGS_FILE_NAME, REGEXP_UUIDV4 } from '@src/lib/constants'
import { getAppSettingsFilePath } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import {
  getProjectIdFromProjectTomlContents,
  getZookeeperConversationFromProjectTomlContents,
  setZookeeperConversationInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import { withProjectTomlLock } from '@src/lib/projectTomlFile'

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

let pendingOperation = Promise.resolve<unknown>(undefined)

const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pendingOperation.then(operation, operation)
  pendingOperation = result.catch(() => undefined)
  return result
}

export const makeZookeeperConversationStore = (
  fileOperations: FileOperationsRegistryService
): ZookeeperConversationStore => {
  return {
    getProjectConversationId(projectId) {
      return serialize(async () =>
        (await readZookeeperConversations(fileOperations)).get(projectId)
      )
    },
    saveProjectConversationId({ projectId, conversationId }) {
      return serialize(async () => {
        const conversations = await readZookeeperConversations(fileOperations)
        conversations.set(projectId, conversationId)
        await writeZookeeperConversations(fileOperations, conversations)
      })
    },
    deleteProjectConversationId(projectId) {
      return serialize(async () => {
        const conversations = await readZookeeperConversations(fileOperations)
        conversations.delete(projectId)
        await writeZookeeperConversations(fileOperations, conversations)
      })
    },
  }
}

export const makeProjectZookeeperConversationStore = (
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  environmentName: string | undefined
): ZookeeperConversationStore => {
  const projectTomlPath = fsZds.join(projectPath, PROJECT_SETTINGS_FILE_NAME)
  const environment = environmentName ?? ''

  const readProjectToml = async (projectId: string) => {
    if (!environment) {
      return Promise.reject(new Error('Missing Zookeeper environment'))
    }
    const contents = new TextDecoder().decode(
      await fileOperations.readFile(projectTomlPath)
    )
    if (getProjectIdFromProjectTomlContents(contents) !== projectId) {
      return Promise.reject(
        new Error('Project identity changed or project.toml is invalid')
      )
    }
    return contents
  }

  const saveConversation = async (
    contents: string,
    conversationId: string | undefined
  ) => {
    const next = setZookeeperConversationInProjectTomlContents(
      contents,
      environment,
      conversationId
    )
    if (isErr(next)) {
      return Promise.reject(next)
    }
    if (next !== contents) {
      await fileOperations.writeFile(projectTomlPath, next)
    }
  }

  return {
    getProjectConversationId(projectId) {
      return withProjectTomlLock(projectTomlPath, async () => {
        const contents = await readProjectToml(projectId)
        const saved = getZookeeperConversationFromProjectTomlContents(
          contents,
          environment
        )
        if (isErr(saved)) {
          return Promise.reject(saved)
        }
        if (saved !== undefined) {
          return saved.conversationId
        }
        const legacy = (await readZookeeperConversations(fileOperations)).get(
          projectId
        )
        if (legacy !== undefined) {
          await saveConversation(contents, legacy)
        }
        return legacy
      })
    },
    saveProjectConversationId({ projectId, conversationId }) {
      return withProjectTomlLock(projectTomlPath, async () => {
        await saveConversation(await readProjectToml(projectId), conversationId)
      })
    },
    deleteProjectConversationId(projectId) {
      return withProjectTomlLock(projectTomlPath, async () => {
        await saveConversation(await readProjectToml(projectId), undefined)
      })
    },
  }
}
