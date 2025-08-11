import {
  addPlaceHoldersForNewFileAndFolder,
  getUniqueCopyPath,
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
          key: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
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
          key: '/home/kevin/zoo/test-project/main.kcl',
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
        key: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
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
        key: '/home/kevin/zoo/test-project/part001',
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
            path: `/${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `/${parentPath}/.zoo-placeholder-file.kcl`,
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
        const parentPath = 'test-project'
        const expectedList = [
          {
            path: `/${parentPath}/.zoo-placeholder-folder`,
            name: '.zoo-placeholder-folder',
            children: [],
          },
          {
            path: `/${parentPath}/part001`,
            name: 'part001',
            children: [
              {
                path: `/${parentPath}/part001/.zoo-placeholder-folder`,
                name: '.zoo-placeholder-folder',
                children: [],
              },
              {
                path: `/${parentPath}/part001/.zoo-placeholder-file.kcl`,
                name: '.zoo-placeholder-file.kcl',
                children: null,
              },
            ],
          },
          {
            path: `/${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
          {
            path: `/${parentPath}/.zoo-placeholder-file.kcl`,
            name: '.zoo-placeholder-file.kcl',
            children: null,
          },
        ]
        const children: FileEntry[] = [
          {
            path: `/${parentPath}/part001`,
            name: 'part001',
            children: [],
          },
          {
            path: `/${parentPath}/main.kcl`,
            name: 'main.kcl',
            children: null,
          },
        ]
        const actual = addPlaceHoldersForNewFileAndFolder(children, parentPath)
        expect(actual).toBe(expectedResult)
        expect(children).toStrictEqual(expectedList)
      })
    })
  })
  describe('copyPasteSourceAndTarget', () => {
    it('should copy folder to folder without collision as -copy-1', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collision as -copy-2', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-2'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collision as -copy-3', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-3'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder to folder without collisions but you have -copy-1 at the end do not get tricked', () => {
      const identifier = '-copy-'
      const expected = '/my/really/cool/path/project-001/parts-copy-1-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          '/my/really/cool/path/project-001/parts-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        '/my/really/cool/path/project-001/parts-copy-1-copy-1',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    it('should copy folder into folder with multiple -copy-1 prefixes but it is properly labelled', () => {
      const identifier = '-copy-'
      const expected =
        '/my/really/cool/path/project-001/parts-copy-1-copy-1-copy-1'
      const actual = getUniqueCopyPath(
        [
          '/my/really/cool/path/project-001/parts',
          // It is duplicated here thus adding the -copy-1 to the end
          '/my/really/cool/path/project-001/parts-copy-1-copy-1',
          '/my/really/cool/path/project-001/parts-copy-2',
          '/my/really/cool/path/project-001/parts-copy-5',
          '/my/really/cool/path/project-001/parts-old',
          '/my/really/cool/path/project-001/parts-new',
        ],
        // Attemping this file path
        '/my/really/cool/path/project-001/parts-copy-1-copy-1',
        identifier,
        false
      )
      expect(actual).toBe(expected)
    })
    describe('extra scenarios', () => {
      it('should copy folder into folder', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts'
        const actual = getUniqueCopyPath(
          [],
          '/root/project-001/parts',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/main.kcl'
        const actual = getUniqueCopyPath(
          [],
          '/root/project-001/parts/main.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder with many files but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/main.kcl'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/a.kcl',
            '/root/project-001/parts/b.kcl',
            '/root/project-001/parts/c.kcl',
            '/root/project-001/parts/d.kcl',
          ],
          '/root/project-001/parts/main.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy file into folder and they have similar name but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog.kcl'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/dogg.kcl',
            '/root/project-001/parts/doggg.kcl',
            '/root/project-001/parts/d',
            '/root/project-001/parts/do',
            '/root/project-001/parts/dogg',
            '/root/project-001/parts/doggg',
          ],
          '/root/project-001/parts/dog.kcl',
          identifier,
          true
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar name but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/parts/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/parts/d',
            '/root/project-001/parts/do',
            '/root/project-001/parts/dogg',
            '/root/project-001/parts/doggg',
            '/root/project-001/parts/d.kcl',
            '/root/project-001/parts/do.kcl',
            '/root/project-001/parts/dogg.kcl',
            '/root/project-001/parts/doggg.kcl',
          ],
          '/root/project-001/parts/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar absolute path names but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dogg/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dog/d',
            '/root/project-001/dog/do',
            '/root/project-001/dog/dogg',
            '/root/project-001/dog/doggg',
            '/root/project-001/dog/d.kcl',
            '/root/project-001/dog/do.kcl',
            '/root/project-001/dog/dogg.kcl',
            '/root/project-001/dog/doggg.kcl',
          ],
          '/root/project-001/dogg/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and they have similar absolute path names but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dogg/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dogg/d',
            '/root/project-001/dogg/do',
            '/root/project-001/dogg/dogg',
            '/root/project-001/dogg/doggg',
            '/root/project-001/dogg/d.kcl',
            '/root/project-001/dogg/do.kcl',
            '/root/project-001/dogg/dogg.kcl',
            '/root/project-001/dogg/doggg.kcl',
          ],
          '/root/project-001/dogg/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
      it('should copy folder into folder and the folder name shows up in the path but no collision', () => {
        const identifier = '-copy-'
        const expected = '/root/project-001/dog/dog'
        const actual = getUniqueCopyPath(
          [
            '/root/project-001/dog/d',
            '/root/project-001/dog/do',
            '/root/project-001/dog/dogg',
            '/root/project-001/dog/doggg',
            '/root/project-001/dog/d.kcl',
            '/root/project-001/dog/do.kcl',
            '/root/project-001/dog/dogg.kcl',
            '/root/project-001/dog/doggg.kcl',
          ],
          '/root/project-001/dog/dog',
          identifier,
          false
        )
        expect(actual).toBe(expected)
      })
    })
  })
})
