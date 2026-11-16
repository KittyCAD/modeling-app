import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { trackSelectionModifiers } from '@src/lib/selectionModifiers'

it('tracks Shift until release or focus loss, and stops tracking when its manager closes', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom(
          'press',
          'release',
          'other',
          'blur',
          'hide',
          'show',
          'close'
        )
      ),
      (events) => {
        let actual = false
        let expected = false
        let closed = false
        const hidden = vi
          .spyOn(document, 'hidden', 'get')
          .mockReturnValue(false)
        const detach = trackSelectionModifiers({
          setIsShiftDown: (value) => {
            actual = value
          },
        })
        try {
          for (const event of events) {
            if (event === 'close') {
              detach()
              closed = true
              expected = false
            } else if (event === 'hide' || event === 'show') {
              hidden.mockReturnValue(event === 'hide')
              document.dispatchEvent(new Event('visibilitychange'))
            } else if (event === 'blur') {
              window.dispatchEvent(new Event('blur'))
            } else {
              window.dispatchEvent(
                new KeyboardEvent(event === 'release' ? 'keyup' : 'keydown', {
                  key: event === 'other' ? 'a' : 'Shift',
                })
              )
            }
            if (!closed) {
              if (event === 'press') expected = true
              if (['release', 'blur', 'hide'].includes(event)) expected = false
            }
            expect(actual).toBe(expected)
          }
        } finally {
          detach()
          hidden.mockRestore()
        }
      }
    )
  )
})
