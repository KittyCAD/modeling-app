import { Themes } from '@src/lib/theme'
import { ConnectionManager } from '@src/network/connectionManager'

describe('ConnectionManager.ts', () => {
  describe('initialize', () => {
    it('should make a default object', () => {
      const connectionManager = new ConnectionManager()
      expect(connectionManager.connection).toBe(undefined)
    })
    it('should check for default settings', () => {
      const connectionManager = new ConnectionManager()
      const expected = {
        pool: null,
        theme: Themes.Dark,
        highlightEdges: true,
        enableSSAO: true,
        showScaleGrid: false,
        cameraProjection: 'perspective',
        cameraOrbit: 'spherical',
      }
      expect(connectionManager.connection).toBe(undefined)
      expect(connectionManager.settings).toStrictEqual(expected)
      expect(connectionManager.started).toBe(false)
    })
  })
})
