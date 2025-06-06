import {
  LOCAL_STORAGE_TEMPORARY_WORKSPACE,
  LOCAL_STORAGE_OLD_CODE,
  LOCAL_STORAGE_REPLACED_WORKSPACE_THIS_SESSION,
} from '@src/lib/constants'

import { codeManager } from '@src/lib/singletons'

export const goIntoTemporaryWorkspaceModeWithCode = (code: string) => {
  // Save the current code in localStorage and load the new code.
  const oldCode = codeManager.localStoragePersistCode()

  // By default we throw users into a temporary workspace in case
  // they start modifying things on the side
  localStorage.setItem(LOCAL_STORAGE_TEMPORARY_WORKSPACE, 'truthy')
  localStorage.setItem(LOCAL_STORAGE_REPLACED_WORKSPACE_THIS_SESSION, 'truthy')
  localStorage.setItem(LOCAL_STORAGE_OLD_CODE, oldCode)
  codeManager.updateCodeStateEditor(code, true)
  codeManager.writeToFile().catch(console.warn)
}
