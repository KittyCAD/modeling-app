import { getPathOrUrlFromArgs, parseCLIArgs } from '@src/commandLineArgs'

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
  '/home/pierremtb/Documents/zoo-design-studio-projects/project-001/main.kcl',
]

const winDeepLinkArgv = [
  'C:\\Program Files\\Zoo Design Studio\\Zoo Design Studio.exe',
  '--allow-file-access-from-files',
  'zoo-studio:///?create-file=true&name=deeplinkscopy&code=cGxhbmUwMDEgPSBvZmZzZXRQbGFuZSgnWFonLCBvZmZzZXQgPSA1KQo%3D',
]

const winNoPathArgv = [
  'C:\\Program Files\\Zoo Design Studio\\Zoo Design Studio.exe',
  '--allow-file-access-from-files',
]

const winPathArgv = [
  'C:\\Program Files\\Zoo Design Studio\\Zoo Design Studio.exe',
  '--allow-file-access-from-files',
  'C:\\Users\\pierr\\Documents\\zoo-design-studio-projects\\deeplink\\main.kcl',
]

// macos doesn't uses the open-url scheme so is different so no macDeepLinkArgv

const macNoPathArgv = [
  '/Applications/Zoo Design Studio.app/Contents/MacOS/Zoo Design Studio',
]

const macPathArgv = [
  '/Applications/Zoo Design Studio.app/Contents/MacOS/Zoo Design Studio',
  '/Users/pierremtb/Documents/zoo-design-studio-projects/loft/main.kcl',
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
