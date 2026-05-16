import { useEffect, type RefObject } from 'react'

/**
 * Close a dropdown (or similar) when the user clicks outside the referenced element.
 * Attaches a mousedown listener to the document and calls `onOutside` if the
 * click target is not contained within `ref.current`.
 */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void): void {
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, onOutside])
}
