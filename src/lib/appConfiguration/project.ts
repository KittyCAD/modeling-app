import { projects } from '@kittycad/lib'
import { createKCClient } from '@src/lib/kcClient'
import { readProjectZip } from '@src/lib/cloudProjects/runtime/archiveContents'
import type {
  DevAccountConfigRequest,
  LoadedAccountConfig,
} from '@src/lib/appConfiguration/devAccount'

/** Read only app.toml from one exact Project version; never open it as the user's design project. */
export async function loadDevAccountConfig(
  request: DevAccountConfigRequest,
  signal: AbortSignal
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
  const manifest = version.files.find(
    (file) => file.relative_path === 'app.toml'
  )
  if (!manifest)
    return Promise.reject(
      new Error('Configuration Project must contain app.toml at its root.')
    )
  if (manifest.byte_size > 128_000)
    return Promise.reject(new Error('App manifest exceeds 128 KB.'))
  const response = await projects.download_project_version({
    client,
    id: request.projectId,
    version_id: version.id,
    format: 'zip',
    file_ids: manifest.id,
  })
  const files = await readProjectZip(await response.arrayBuffer(), {
    maxBytes: 256_000,
    maxEntries: 8,
  })
  signal.throwIfAborted()
  const file = files.find((file) => file.relativePath === 'app.toml')
  if (!file || file.data.byteLength > 128_000)
    return Promise.reject(
      new Error(
        'Configuration download must contain app.toml of at most 128 KB.'
      )
    )
  if (manifest.sha256) {
    const digest = await crypto.subtle.digest('SHA-256', file.data)
    const actual = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    if (actual !== manifest.sha256.toLowerCase())
      return Promise.reject(
        new Error('App manifest does not match its Project file digest.')
      )
  }
  return {
    contents: new TextDecoder('utf-8', { fatal: true }).decode(file.data),
    revision: version.id,
  }
}
