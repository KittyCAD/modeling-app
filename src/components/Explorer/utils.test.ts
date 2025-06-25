import { isRowFake } from '@src/components/Explorer/utils'
import type { FileExplorerEntry}  from '@src/components/Explorer/utils'

describe('Explorer utils.ts', () => {
  describe('isRowFake', () =>{
    describe('when row is a file with fake placeholder name',() =>{
      it('should be fake',  () => {
        const expected = true
        const file : FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
          name: '.zoo-placeholder-file.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/.zoo-placeholder-file.kcl',
          setSize: 1,
          positionInSet: 1
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
    })
    describe('when row is a file with a real placeholder name', () => {
      it('should not be fake', () => {
        const expected = false
        const file : FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/main.kcl',
          name: 'main.kcl',
          children: null,
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/main.kcl',
          setSize: 1,
          positionInSet: 1
        }
        const actual = isRowFake(file)
        expect(expected).toBe(actual)
      })
      })
    })
    describe('when row is a folder with a fake placeholder name',  () => {
      it('should be fake', () =>{
        const expected = true
        const folder : FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
          name: '.zoo-placeholder-folder',
          children: [],
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/.zoo-placeholder-folder',
          setSize: 1,
          positionInSet: 1
        }
        const actual = isRowFake(folder)
        expect(expected).toBe(actual)
      })
    })
    describe('when row is a folder with a real placeholder name',  () => {
      it('should not be fake', () =>{
        const expected = false
        const folder : FileExplorerEntry = {
          path: '/home/kevin/zoo/test-project/part001',
          name: 'part001',
          children: [],
          parentPath: '/home/kevin/zoo/test-project',
          level: 0,
          index: 0,
          key: '/home/kevin/zoo/test-project/part001',
          setSize: 1,
          positionInSet: 1
        }
        const actual = isRowFake(folder)
        expect(expected).toBe(actual)
      })
    })
})