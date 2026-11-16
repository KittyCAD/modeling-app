import type { ProjectFileResponse, ProjectSummaryResponse } from '@kittycad/lib'

export type Revision = string

/** One normalized file payload included in a cloud project archive upload. */
export type ProjectArchiveFile = {
  relativePath: string
  data: Uint8Array
}

export type RemoteProjectSummary = Pick<ProjectSummaryResponse, 'id'> &
  Partial<Omit<ProjectSummaryResponse, 'id' | 'revision'>> & {
    revision?: Revision | number
  }

/** Version-specific identity and content metadata for one remote file. */
export type RemoteProjectFile = Pick<
  ProjectFileResponse,
  'id' | 'relative_path' | 'byte_size' | 'sha256'
>

export type RemoteProject = RemoteProjectSummary & {
  files?: readonly RemoteProjectFile[]
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
