import { cloudProjectsExtension } from '@src/lib/cloudProjects/registry/extension'
import library from '@src/lib/cloudProjects/registry/library'
import { cloudProjectPollingExtension } from '@src/lib/cloudProjects/registry/polling'
import { cloudProjectSessionExtension } from '@src/lib/cloudProjects/registry/session'
export default [
  cloudProjectsExtension,
  cloudProjectSessionExtension,
  cloudProjectPollingExtension,
  library,
]
