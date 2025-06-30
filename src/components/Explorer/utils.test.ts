import {
  addPlaceHoldersForNewFileAndFolder,
  isRowFake,
} from '@src/components/Explorer/utils'
import type { FileExplorerEntry } from '@src/components/Explorer/utils'
import type { FileEntry } from '@src/lib/project'

describe('Explorer utils.ts', () => {
  describe('isRowFake', () => {
    describe('when row is a file with fake placeholder name', () => {
      it('should be fake', () => {
        const expected = true
        const file: FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
          name: '.zoo-placeholder-file.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          setSize: 1,
          positionInSet: 1,
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
    })
    describe('when row is a file with a real placeholder name', () => {
      it('should not be fake', () => {
        const expected = false
        const file: FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/main.kcl',
          name: 'main.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          setSize: 1,
          positionInSet: 1,
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
    })
  })
  describe('when row is a folder with a fake placeholder name', () => {
    it('should be fake', () => {
      const expected = true
      const folder: FileExplorerEntry = {
        path: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
        name: '.zoo-placeholder-folder',
        children: [],
        parentPath: '/home/kevin/zoo/test-project',
        level: 0,
        index: 0,
        setSize: 1,
        positionInSet: 1,
      }
      const actual = isRowFake(folder)
      expect(expected).toBe(actual)
    })
  })
  describe('when row is a folder with a real placeholder name', () => {
    it('should not be fake', () => {
      const expected = false
      const folder: FileExplorerEntry = {
        path: '/home/kevin/zoo/test-project/part001',
        name: 'part001',
        children: [],
        parentPath: '/home/kevin/zoo/test-project',
        level: 0,
        index: 0,
        setSize: 1,
        positionInSet: 1,
      }
      const actual = isRowFake(folder)
      expect(expected).toBe(actual)
    })
  })

  describe('addPlaceHoldersForNewFileAndFolder', () => {
    describe('when children is null', () => {
      it('should immediately return', () => {
        const expectedResult = undefined
        const children = null
        const parentPath = 'test-project'
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)

        expect(actual).toBe(expectedResult)
        expect(children).toBe(null)
      })
    })
    describe('when children is empty array', () => {
      it('should place two placeholder files', () => {
        const expectedResult = undefined
        const parentPath = 'test-project'
        const expectedList = [
          {
            path: `${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `${parentPath}/.zoo-placeholder-file.kcl`,
            name: '.zoo-placeholder-file.kcl',
            children: null,
          },
        ]
        const children: FileEntry[] = []
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)
        expect(actual).toBe(expectedResult)
        expect(children).toStrictEqual(expectedList)
      })
    })
    describe('when children has a file and folder', () => {
      it('should place four placeholder files', () => {
        const expectedResult = undefined
        const parentPath = '/test-project'
        const expectedList = [
          {
            path: `${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `${parentPath}/part001`,
            name: 'part001',
            children: [
              {
                path: `${parentPath}/part001/.zoo-placeholder-folder`,
                name: '.zoo-placeholder-folder',
                children: [],
              },
              {
                path: `${parentPath}/part001/.zoo-placeholder-file.kcl`,
                name: '.zoo-placeholder-file.kcl',
                children: null,
              },
            ],
          },
          {
            path: `${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
          {
            path: `${parentPath}/.zoo-placeholder-file.kcl`,
            name: '.zoo-placeholder-file.kcl',
            children: null,
          },
        ]
        const children: FileEntry[] = [
          {
            path: `${parentPath}/part001`,
            name: 'part001',
            children: [],
          },
          {
            path: `${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
        ]
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)
        console.log(children)
        expect(actual).toBe(expectedResult)
        expect(children).toStrictEqual(expectedList)
      })
    })
  })
})
