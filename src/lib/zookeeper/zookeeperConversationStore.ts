import { PROJECT_SETTINGS_FILE_NAME, REGEXP_UUIDV4 } from '@src/lib/constants'
import { getAppSettingsFilePath, isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import {
  getProjectIdFromProjectTomlContents,
  getZookeeperConversationMetadataFromProjectTomlContents,
  setZookeeperConversationInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'

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

export type ProjectZookeeperConversationStore = Omit<
  ZookeeperConversationStore,
  'deleteProjectConversationId'
> & {
  getProjectConversationIds: (projectId: string) => Promise<string[]>
  selectProjectConversationId: (args: {
    projectId: string
    conversationId: string
  }) => Promise<void>
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
  fileOperations: FileOperationsRegistryService,
  strict = false
): Promise<ZookeeperConversations> => {
  try {
    const json = new TextDecoder().decode(
      await fileOperations.readFile(await getZookeeperConversationsFilePath())
    )
    return jsonToZookeeperConversations(json ?? '')
  } catch (error) {
    if (strict) {
      return isPathNotFoundError(error) ? new Map() : Promise.reject(error)
    }
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

// TODO: Coordinate project.toml updates with settings and cloud writes.
// https://github.com/KittyCAD/modeling-app/pull/14058#discussion_r4069113804
export const makeProjectZookeeperConversationStore = (
  fileOperations: FileOperationsRegistryService,
  projectPath: string,
  environmentName: string | undefined
): ProjectZookeeperConversationStore => {
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
    conversationId: string,
    options: { prepend?: boolean; select?: boolean } = {}
  ) => {
    const next = setZookeeperConversationInProjectTomlContents(
      contents,
      environment,
      conversationId,
      options
    )
    if (isErr(next)) {
      return Promise.reject(next)
    }
    if (next !== contents) {
      await fileOperations.writeFile(projectTomlPath, next)
    }
  }

  const getProjectConversationIds = (projectId: string) =>
    serialize(async () => {
      const contents = await readProjectToml(projectId)
      const saved = getZookeeperConversationMetadataFromProjectTomlContents(
        contents,
        environment
      )
      if (isErr(saved)) {
        return Promise.reject(saved)
      }
      if (!saved.canMigrateLegacyConversation) {
        return saved.conversationIds
      }
      const legacy = (
        await readZookeeperConversations(fileOperations, true)
      ).get(projectId)
      if (legacy !== undefined && !saved.conversationIds.includes(legacy)) {
        // Recover older IDs without changing which conversation the current UI resumes.
        await saveConversation(contents, legacy, { prepend: true })
        return [legacy, ...saved.conversationIds]
      }
      return saved.conversationIds
    })

  return {
    getProjectConversationIds,
    async getProjectConversationId(projectId) {
      return (await getProjectConversationIds(projectId)).at(-1)
    },
    saveProjectConversationId({ projectId, conversationId }) {
      return serialize(async () => {
        await saveConversation(await readProjectToml(projectId), conversationId)
      })
    },
    selectProjectConversationId({ projectId, conversationId }) {
      return serialize(async () => {
        await saveConversation(
          await readProjectToml(projectId),
          conversationId,
          {
            select: true,
          }
        )
      })
    },
  }
}
