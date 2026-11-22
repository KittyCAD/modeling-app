import { cloudProjectsExtension } from '@src/lib/cloudProjects/registry/extension'
import library from '@src/lib/cloudProjects/registry/library'
import nextSession from '@src/lib/cloudProjects/registry/nextSession'
import { cloudProjectPollingExtension } from '@src/lib/cloudProjects/registry/polling'
import { cloudProjectSessionExtension } from '@src/lib/cloudProjects/registry/session'
export default [
  nextSession,
  cloudProjectsExtension,
  cloudProjectSessionExtension,
  cloudProjectPollingExtension,
  library,
]
