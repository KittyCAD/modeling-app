import { projects, type ProjectFileResponse } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'
import { readProjectZip } from '@src/lib/cloudProjects/runtime/archiveContents'
import { parseAppManifest } from '@src/registry/appManifest'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import {
  resolveDevAccountConfig,
  type DevAccountConfigRequest,
  type LoadedAccountConfig,
  type LoadedAccountExtension,
} from '@src/lib/appConfiguration/devAccount'
import { isErr } from '@src/lib/trap'

/** Resolve selected source files from exact Project versions without opening a design project. */
export async function loadDevAccountConfig(
  request: DevAccountConfigRequest,
  signal: AbortSignal,
  baseline: readonly BundledRegistryItemId[] = defaultRegistryItemIds
): Promise<LoadedAccountConfig> {
  const client = createKCClient(request.token, request.baseUrl, { signal })
  const project = await projects.get_project({ client, id: request.projectId })
  signal.throwIfAborted()
  if (!project.revision)
    return Promise.reject(
      new Error('Configuration Project has no content version.')
    )
  const version = await projects.get_project_version({
    client,
    id: request.projectId,
    version_id: project.revision,
  })
  type Version = Awaited<ReturnType<typeof projects.get_project_version>>
  const versions = new Map<string, Promise<Version>>([
    [JSON.stringify([request.projectId, version.id]), Promise.resolve(version)],
  ])
  const readFile = async (
    projectId: string,
    snapshot: Version,
    entrypoint: string,
    expectedDigest?: string
  ) => {
    signal.throwIfAborted()
    const metadata: ProjectFileResponse | undefined = snapshot.files.find(
      (file) => file.relative_path === entrypoint
    )
    if (!metadata)
      return Promise.reject(
        new Error(
          `Configuration Project version must contain ${entrypoint}${entrypoint === 'app.toml' ? ' at its root' : ''}.`
        )
      )
    if (metadata.byte_size > 128_000)
      return Promise.reject(
        new Error(`Configuration file ${entrypoint} exceeds 128 KB.`)
      )
    const response = await projects.download_project_version({
      client,
      id: projectId,
      version_id: snapshot.id,
      format: 'zip',
      file_ids: metadata.id,
    })
    const files = await readProjectZip(await response.arrayBuffer(), {
      maxBytes: 256_000,
      maxEntries: 8,
    })
    signal.throwIfAborted()
    const file = files.find((file) => file.relativePath === entrypoint)
    if (
      !file ||
      file.data.byteLength > 128_000 ||
      files.some((file) => file.relativePath !== entrypoint)
    )
      return Promise.reject(
        new Error(
          `Configuration download must contain only ${entrypoint} of at most 128 KB.`
        )
      )
    const digest = await crypto.subtle.digest('SHA-256', file.data)
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    for (const expected of [metadata.sha256, expectedDigest]) {
      if (expected && sha256 !== expected.toLowerCase())
        return Promise.reject(
          new Error(
            `Configuration file ${entrypoint} does not match its SHA-256 digest.`
          )
        )
    }
    return {
      contents: new TextDecoder('utf-8', { fatal: true }).decode(file.data),
      sha256,
    }
  }
  const { contents } = await readFile(request.projectId, version, 'app.toml')
  const manifest = parseAppManifest(contents)
  if (isErr(manifest)) return Promise.reject(manifest)
  const selection = resolveDevAccountConfig(contents, baseline)
  if (isErr(selection)) return Promise.reject(selection)
  const sources: LoadedAccountExtension[] = []
  for (const id of selection.sourceIds) {
    const source = manifest.sources?.[id]
    if (!source)
      return Promise.reject(new Error(`Missing source declaration for ${id}.`))
    const projectId = source.projectId ?? request.projectId
    const versionId = source.versionId ?? version.id
    const key = JSON.stringify([projectId, versionId])
    let snapshot = versions.get(key)
    if (!snapshot) {
      snapshot = projects.get_project_version({
        client,
        id: projectId,
        version_id: versionId,
      })
      versions.set(key, snapshot)
    }
    const pinned = await snapshot
    const file = await readFile(
      projectId,
      pinned,
      source.entrypoint,
      source.sha256
    )
    sources.push({ id, projectId, versionId: pinned.id, ...file })
  }
  return {
    contents,
    revision: version.id,
    ...(sources.length ? { sources } : {}),
  }
}
