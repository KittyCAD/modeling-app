import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import {
  getProjectIdFromProjectTomlContents,
  setProjectIdInProjectTomlContents,
} from '@src/lib/projectTomlMetadata'
import { isErr } from '@src/lib/trap'
import { v4 as uuidv4 } from 'uuid'

/**
 * Separates folders that were copied outside Zoo Design Studio and therefore
 * still share one local project identity. The selected folder keeps that
 * identity; every other folder receives a new one and starts without a saved
 * Zookeeper conversation.
 */
export async function separateProjectsSharingProjectId({
  projectPaths,
  keepProjectPath,
}: {
  projectPaths: readonly string[]
  keepProjectPath?: string
}) {
  const uniqueProjectPaths = Array.from(new Set(projectPaths))
  if (uniqueProjectPaths.length < 2) {
    return Promise.reject(
      new Error('At least two project copies are required to separate them.')
    )
  }
  if (keepProjectPath && !uniqueProjectPaths.includes(keepProjectPath)) {
    return Promise.reject(
      new Error('The project selected to keep is not one of the copies.')
    )
  }

  const projects = await Promise.all(
    uniqueProjectPaths.map(async (projectPath) => {
      const projectTomlPath = fsZds.join(
        projectPath,
        PROJECT_SETTINGS_FILE_NAME
      )
      const contents = await fsZds.readFile(projectTomlPath, {
        encoding: 'utf-8',
      })
      return {
        contents,
        projectId: getProjectIdFromProjectTomlContents(contents),
        projectPath,
        projectTomlPath,
      }
    })
  )
  const sharedProjectId = projects[0]?.projectId
  if (
    !sharedProjectId ||
    projects.some(({ projectId }) => projectId !== sharedProjectId)
  ) {
    return Promise.reject(
      new Error('These project folders no longer share the same project ID.')
    )
  }

  const updates: { nextContents: string; projectTomlPath: string }[] = []
  for (const { contents, projectPath, projectTomlPath } of projects) {
    if (projectPath === keepProjectPath) {
      continue
    }
    const nextContents = setProjectIdInProjectTomlContents(contents, uuidv4())
    if (isErr(nextContents)) {
      return Promise.reject(nextContents)
    }
    updates.push({ nextContents, projectTomlPath })
  }

  await Promise.all(
    updates.map(({ nextContents, projectTomlPath }) =>
      fsZds.writeFile(projectTomlPath, new TextEncoder().encode(nextContents))
    )
  )

  return { sharedProjectId }
}
