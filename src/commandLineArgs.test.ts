import { getPathOrUrlFromArgs, parseCLIArgs } from 'commandLineArgs'

const linuxSecondInstancePathArgv = [
  '/tmp/.mount_Zoo ModOoQcl/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '/home/pierremtb/Documents/zoo-modeling-app-projects/project-001/main.kcl',
]

const winSecondInstancePathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'D:\\Users\\pierre_win10\\Documents\\zoo-modeling-app-projects\\project-005\\main.kcl',
]

const linuxColdStartNoPathArgv = [
  '/tmp/.mount_Zoo MogQS2hd/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
]

const linuxSecondInstanceDeepLinkArgv = [
  '/tmp/.mount_Zoo Movq3t0x/zoo-modeling-app',
  '--no-sandbox',
  '--allow-file-access-from-files',
  'zoo-studio://?create-file=true&name=bloobloo&code=c2tldGNoMDAxID0gc3RhcnRTa2V0Y2hPbignWFonKQogIHw%2BIHN0YXJ0UHJvZmlsZUF0KFs1MS4zNiwgMjA3LjQxXSwgJSkKICB8PiBsaW5lKGVuZCA9IFsxODguOTcsIC0xMTEuMjhdKQogIHw%2BIGxpbmUoZW5kID0gWy02Ny44MiwgLTIyNy4xNl0pCiAgfD4gbGluZShlbmQgPSBbLTEyNS4xLCA0Mi4xNF0pCiAgfD4gbGluZShlbmQgPSBbMjAuNDEsIDk4Ljc3XSkKICB8PiBsaW5lKGVuZCA9IFs3My4wOSwgLTY1Ljg1XSkKICB8PiBsaW5lKGVuZCA9IFs0NC43NywgNzYuMzhdKQogIHw%2BIGxpbmUoZW5kID0gWy05LjIyLCA1Ny45NV0pCiAgfD4geExpbmUoLTExMC42MSwgJSkKICB8PiBsaW5lKGVuZEFic29sdXRlID0gWzAsIDE0My41NF0pCiAgfD4gbGluZShlbmQgPSBbNDcuNDEsIDcuOV0pCiAgfD4gbGluZShlbmQgPSBbLTI1LjAyLCA0Mi44XSkKICB8PiBsaW5lKGVuZEFic29sdXRlID0gW3Byb2ZpbGVTdGFydFgoJSksIHByb2ZpbGVTdGFydFkoJSldKQogIHw%2BIGNsb3NlKCkKZXh0cnVkZTAwMSA9IGV4dHJ1ZGUoc2tldGNoMDAxLCBsZW5ndGggPSA1MCkKc2tldGNoMDAyID0gc3RhcnRTa2V0Y2hPbihleHRydWRlMDAxLCAnRU5EJykKICB8PiBjaXJjbGUoewogICAgICAgY2VudGVyID0gWzEwMS41MSwgMTM1LjY2XSwKICAgICAgIHJhZGl1cyA9IDI0LjM2CiAgICAgfSwgJSkKZXh0cnVkZTAwMiA9IGV4dHJ1ZGUoc2tldGNoMDAyLCBsZW5ndGggPSA1KQ%3D%3D',
]

const winSecondInstanceDeepLinkArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
  '--allow-file-access-from-files',
  'zoo-studio:///?create-file=true&name=project-005&code=c2tldGNoMDAxID0gc3RhcnRTa2V0Y2hPbignWFonKQogIHw%2BIHN0YXJ0UHJvZmlsZUF0KFsyMTYuNTgsIDE1NC44Ml0sICUpCiAgfD4geExpbmUoLTM3Mi4yNSwgJSkKICB8PiBsaW5lKFstMzEuMywgLTI2Ni41XSwgJSkKICB8PiBsaW5lKFs0MDYuMDksIC0xMTMuMzZdLCAlKQogIHw%2BIGxpbmUoWzEwNC45MSwgMjQyLjgxXSwgJSkKICB8PiBsaW5lVG8oW3Byb2ZpbGVTdGFydFgoJSksIHByb2ZpbGVTdGFydFkoJSldLCAlKQogIHw%2BIGNsb3NlKCUpCmV4dHJ1ZGUwMDEgPSBleHRydWRlKDUsIHNrZXRjaDAwMSkKcmFkaXVzMDAxID0gMTAKc2tldGNoMDAyID0gc3RhcnRTa2V0Y2hPbihleHRydWRlMDAxLCAnRU5EJykKICB8PiBjaXJjbGUoewogICAgICAgY2VudGVyID0gWzI1OS42MSwgLTI2LjU2XSwKICAgICAgIHJhZGl1cyA9IHJhZGl1czAwMQogICAgIH0sICUpCmV4dHJ1ZGUwMDIgPSBleHRydWRlKDUsIHNrZXRjaDAwMikK',
]

const macColdStartNoPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
]

const macColdStartPathArgv = [
  '/Applications/Zoo Modeling App.app/Contents/MacOS/Zoo Modeling App',
  '/Users/pierremtb/Documents/zoo-modeling-app-projects/loft/main.kcl',
]

const winColdStartNoPathArgv = [
  'C:\\Program Files\\Zoo Modeling App\\Zoo Modeling App.exe',
]

describe('getPathOrUrlFromArgs', () => {
  it('should parse linux second-instance path arg', () => {
    const args = parseCLIArgs(linuxSecondInstancePathArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
  })

  it('should parse win second-instance path arg', () => {
    const args = parseCLIArgs(winSecondInstancePathArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
  })

  it('should parse mac cold start path arg', () => {
    const args = parseCLIArgs(macColdStartPathArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('main.kcl')
  })

  it('should return undefined on linux cold start without path arg', () => {
    const args = parseCLIArgs(linuxColdStartNoPathArgv)
    expect(getPathOrUrlFromArgs(args)).toBeUndefined()
  })

  it('should return undefined on mac cold start without path arg', () => {
    const args = parseCLIArgs(macColdStartNoPathArgv)
    expect(getPathOrUrlFromArgs(args)).toBeUndefined()
  })

  it('should return undefined on win cold start without path arg', () => {
    const args = parseCLIArgs(winColdStartNoPathArgv)
    expect(getPathOrUrlFromArgs(args)).toBeUndefined()
  })

  it('should parse linux second-instance deep link arg', () => {
    const args = parseCLIArgs(linuxSecondInstanceDeepLinkArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('zoo-studio://')
  })

  it('should parse win second-instance deep link arg', () => {
    const args = parseCLIArgs(winSecondInstanceDeepLinkArgv)
    expect(getPathOrUrlFromArgs(args)).toContain('zoo-studio://')
  })
})
