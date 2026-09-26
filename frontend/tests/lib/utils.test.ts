import { describe, it, expect } from 'vitest'
import { cn } from '../../lib/utils'

describe('cn (className utility)', () => {
  it('merges class names', () => {
    const result = cn('foo', 'bar')
    expect(result).toBe('foo bar')
  })

  it('handles conditional classes', () => {
    const isActive = true
    const result = cn('base', isActive && 'active')
    expect(result).toBe('base active')
  })

  it('handles false conditions', () => {
    const isActive = false
    const result = cn('base', isActive && 'active')
    expect(result).toBe('base')
  })

  it('handles undefined values', () => {
    const result = cn('base', undefined, 'middle', undefined, 'end')
    expect(result).toBe('base middle end')
  })

  it('handles empty strings', () => {
    const result = cn('', 'foo', '')
    expect(result).toBe('foo')
  })

  it('merges tailwind classes with conflicting properties', () => {
    const result = cn('px-2 px-4')
    expect(result).toBe('px-4')
  })

  it('handles array of classes', () => {
    const classes = ['foo', 'bar']
    const result = cn(classes)
    expect(result).toBe('foo bar')
  })
})
