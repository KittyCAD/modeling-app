import { getPathOrUrlFromArgs, parseCLIArgs } from 'commandLineArgs'

const linuxSecondInstancePathArgv = [
  '/tmp/.mount_Zoo ModOoQcl/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '/home/pierremtb/Documents/zoo-modeling-app-projects/project-001/main.kcl',
]

const linuxSecondInstanceDeepLinkArgv = [
  '/tmp/.mount_Zoo Movq3t0x/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  'zoo-studio://?create-file=true&name=bloobloo&code=c2tldGNoMDAxID0gc3RhcnRTa2V0Y2hPbignWFonKQogIHw%2BIHN0YXJ0UHJvZmlsZUF0KFs1MS4zNiwgMjA3LjQxXSwgJSkKICB8PiBsaW5lKGVuZCA9IFsxODguOTcsIC0xMTEuMjhdKQogIHw%2BIGxpbmUoZW5kID0gWy02Ny44MiwgLTIyNy4xNl0pCiAgfD4gbGluZShlbmQgPSBbLTEyNS4xLCA0Mi4xNF0pCiAgfD4gbGluZShlbmQgPSBbMjAuNDEsIDk4Ljc3XSkKICB8PiBsaW5lKGVuZCA9IFs3My4wOSwgLTY1Ljg1XSkKICB8PiBsaW5lKGVuZCA9IFs0NC43NywgNzYuMzhdKQogIHw%2BIGxpbmUoZW5kID0gWy05LjIyLCA1Ny45NV0pCiAgfD4geExpbmUoLTExMC42MSwgJSkKICB8PiBsaW5lKGVuZEFic29sdXRlID0gWzAsIDE0My41NF0pCiAgfD4gbGluZShlbmQgPSBbNDcuNDEsIDcuOV0pCiAgfD4gbGluZShlbmQgPSBbLTI1LjAyLCA0Mi44XSkKICB8PiBsaW5lKGVuZEFic29sdXRlID0gW3Byb2ZpbGVTdGFydFgoJSksIHByb2ZpbGVTdGFydFkoJSldKQogIHw%2BIGNsb3NlKCkKZXh0cnVkZTAwMSA9IGV4dHJ1ZGUoc2tldGNoMDAxLCBsZW5ndGggPSA1MCkKc2tldGNoMDAyID0gc3RhcnRTa2V0Y2hPbihleHRydWRlMDAxLCAnRU5EJykKICB8PiBjaXJjbGUoewogICAgICAgY2VudGVyID0gWzEwMS41MSwgMTM1LjY2XSwKICAgICAgIHJhZGl1cyA9IDI0LjM2CiAgICAgfSwgJSkKZXh0cnVkZTAwMiA9IGV4dHJ1ZGUoc2tldGNoMDAyLCBsZW5ndGggPSA1KQ%3D%3D',
]

const linuxColdStartNoPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
]

const linuxColdStartPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '/home/pierremtb/Documents/zoo-modeling-app-projects/project-001/main.kcl',
]

const macColdStartNoPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
]

const macColdStartPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
  '/Users/pierremtb/Documents/zoo-modeling-app-projects/loft/main.kcl',
]

const winSecondInstanceDeepLinkArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'zoo-studio:///?create-file=true&name=deeplinkscopy&code=cGxhbmUwMDEgPSBvZmZzZXRQbGFuZSgnWFonLCBvZmZzZXQgPSA1KQo%3D'
]

const winSecondInstancePathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'D:\\Users\\pierre_win10\\Documents\\zoo-modeling-app-projects\\project-005\\main.kcl',
]

const winColdStartNoPathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
]

const winColdStartPathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'C:\\Users\\pierr\\Documents\\zoo-modeling-app-projects\\deeplink\\main.kcl',
]

describe('getPathOrUrlFromArgs', () => {
  [
    ['linux', linuxSecondInstancePathArgv],
    ['windows', winSecondInstancePathArgv],
    // macos doesn't uses the open-url scheme so is different
  ].map(([os, argv]) => {
    it(`should parse second-instance path argv on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
    })
  });

  [
    ['linux', linuxSecondInstanceDeepLinkArgv],
    ['windows', winSecondInstanceDeepLinkArgv],
    // macos doesn't uses the open-url scheme so is different
  ].map(([os, argv]) => {
    it(`should parse second-instance deep link arg on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toContain('zoo-studio://')
    })
  });

  [
    ['linux', linuxColdStartPathArgv],
    ['windows', winColdStartPathArgv],
    ['mac', macColdStartPathArgv],
  ].map(([os, argv]) => {
    it(`should parse cold start path argv on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
    })
  });

  [
    ['linux', linuxColdStartNoPathArgv],
    ['windows', winColdStartNoPathArgv],
    ['mac', macColdStartNoPathArgv],
  ].map(([os, argv]) => {
    it(`should return undefined on cold start without path arg on ${os}`, () => {
      const args = parseCLIArgs(argv as string[])
      expect(getPathOrUrlFromArgs(args)).toBeUndefined()
    })
  });
})
