import { SystemIOMachineEvents, SystemIOMachineActors, SystemIOContext} from "@src/machines/systemIO/utils"
import { systemIOMachine} from "@src/machines/systemIO/systemIOMachine"
import { setup, fromPromise, assign, assertEvent} from 'xstate'
import type { Project } from '@src/lib/project'

export const systemIOMachineWeb = systemIOMachine.provide({
  actors: {
    [SystemIOMachineActors.readFoldersFromProjectDirectory]: fromPromise(async ({input:context}:{input:SystemIOContext}) => {
      const projects: Project[] = []
      console.log('nothing!')
      return projects
    })
  }
})
