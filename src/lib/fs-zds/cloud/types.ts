import type { ProjectResponse } from '@kittycad/lib'

export type Revision = string

/** One normalized file payload included in a cloud project archive upload. */
export type ProjectArchiveFile = {
  relativePath: string
  data: Uint8Array
}

export type RemoteProjectSummary = {
  id: string
  title?: string
  updated_at?: string
  revision?: Revision | number
  /** Older responses and locally known projects may not have access metadata. */
  access?: ProjectResponse['access']
  [key: string]: unknown
}

/** Full remote project metadata used before archive download. */
export type RemoteProject = RemoteProjectSummary

export type CreatedRemoteProject = RemoteProject &
  Pick<ProjectResponse, 'revision'> & {
    files: Required<
      Pick<
        ProjectResponse['files'][number],
        'relative_path' | 'byte_size' | 'sha256'
      >
    >[]
  }

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
