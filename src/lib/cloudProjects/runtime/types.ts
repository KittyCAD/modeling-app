import type { ProjectResponse } from '@kittycad/lib'

export type Revision = string

/** One normalized file payload included in a cloud project archive upload. */
export type ProjectArchiveFile = {
  relativePath: string
  data: Uint8Array
}

export type RemoteProjectSummary = Pick<ProjectResponse, 'id'> &
  Partial<Omit<ProjectResponse, 'id' | 'revision'>> & {
    revision?: Revision | number
  }

/** Full remote project metadata used before archive download. */
export type RemoteProject = RemoteProjectSummary

/** Metadata fields sent alongside whole-project cloud archive uploads. */
export type ProjectUploadBody = {
  title: string
  description: string
  category_ids: string[]
  entrypoint_path: string
  project_toml_path: string
  expected_revision?: Revision
  deleted_paths?: string[]
}

/** Publication metadata that whole-project replacements must preserve. */
export type ProjectUploadPublicationMetadata = {
  description: string
  category_ids: string[]
}

export type CloudApiConfig = {
  enabled: boolean
  token?: string
  baseUrl?: string
  accountId?: string
}
