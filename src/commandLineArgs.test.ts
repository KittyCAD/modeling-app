import { getPathOrUrlFromArgs, parseCLIArgs } from 'commandLineArgs'

const linuxSecondInstancePathArgv = [
  '/tmp/.mount_Zoo ModOoQcl/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '/home/pierremtb/Documents/zoo-modeling-app-projects/project-001/main.kcl',
]

const linuxColdStartNoPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
]

describe('getPathOrUrlFromArgs', () => {
  it('should parse linux second-instance path arg', () => {
    const args = parseCLIArgs(linuxSecondInstancePathArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
  })

  it('should return undefined on linux cold start without path arg', () => {
    const args = parseCLIArgs(linuxColdStartNoPathArgv)
    expect(getPathOrUrlFromArgs(args)).toBeUndefined()
  })
})
