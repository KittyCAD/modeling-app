import { getPathOrUrlFromArgs, parseCLIArgs } from 'commandLineArgs'

const linuxDeepLinkArgv = [
  '/tmp/.mount_Zoo Movq3t0x/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  'zoo-studio://?create-file=true&name=deeplinks&code=cGxhbmUwMDEgPSBvZmZzZXRQbGFuZSgnWFonLCBvZmZzZXQgPSA1KQ%3D%3D',
]

const linuxNoPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
]

const linuxPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '/home/pierremtb/Documents/zoo-modeling-app-projects/project-001/main.kcl',
]

const winDeepLinkArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'zoo-studio:///?create-file=true&name=deeplinkscopy&code=cGxhbmUwMDEgPSBvZmZzZXRQbGFuZSgnWFonLCBvZmZzZXQgPSA1KQo%3D',
]

const winNoPathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
]

const winPathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'C:\\Users\\pierr\\Documents\\zoo-modeling-app-projects\\deeplink\\main.kcl',
]

// macos doesn't uses the open-url scheme so is different so no macDeepLinkArgv

const macNoPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
]

const macPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
  '/Users/pierremtb/Documents/zoo-modeling-app-projects/loft/main.kcl',
]

describe('getPathOrUrlFromArgs', () => {
  ;[
    ['linux', linuxDeepLinkArgv],
    ['windows', winDeepLinkArgv],
    // macos doesn't uses the open-url scheme so is different
  ].map(([os, argv]) => {
    it(`should parse second-instance deep link argv on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toContain('zoo-studio://')
    })
  })
  ;[
    ['linux', linuxPathArgv],
    ['windows', winPathArgv],
    ['mac', macPathArgv],
  ].map(([os, argv]) => {
    it(`should parse path argv on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
    })
  })
  ;[
    ['linux', linuxNoPathArgv],
    ['windows', winNoPathArgv],
    ['mac', macNoPathArgv],
  ].map(([os, argv]) => {
    it(`should return undefined without path argv on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toBeUndefined()
    })
  })
})
