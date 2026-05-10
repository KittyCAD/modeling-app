import { signal } from '@preact/signals-core'
import type { RollbackEditSession } from '@src/lang/modifyAst/rollback'
import type { OpenCascadeRollbackEditService } from '@src/registry/contracts/openCascadeRollbackEdit'

const session = signal<RollbackEditSession | undefined>(undefined)

export const engineSceneOpenCascadeRollbackEditService: OpenCascadeRollbackEditService =
  {
    session,
    begin(nextSession) {
      session.value = nextSession
    },
    markManual() {
      const currentSession = session.value
      if (!currentSession) {
        return
      }
      session.value = { ...currentSession, isManual: true }
    },
    consumeTemporary() {
      const currentSession = session.value
      if (!currentSession || currentSession.isManual) {
        session.value = undefined
        return undefined
      }
      session.value = undefined
      return currentSession
    },
    clear() {
      session.value = undefined
    },
  }
