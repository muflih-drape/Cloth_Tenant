import { describe, it, expect } from 'vitest'
import {
  variantColorLabel,
  orderItemColorSuffix,
} from '../../lib/colorLabel'

describe('variantColorLabel', () => {
  it('shows the stored display_order when present', () => {
    expect(variantColorLabel(2, 3)).toBe('Color #2')
    expect(variantColorLabel('04', 3)).toBe('Color #04')
  })

  it('falls back to the position when display_order is null', () => {
    expect(variantColorLabel(null, 3)).toBe('Color #3')
    expect(variantColorLabel(undefined, 1)).toBe('Color #1')
  })

  it('falls back to the position when display_order is blank', () => {
    expect(variantColorLabel('', 3)).toBe('Color #3')
    expect(variantColorLabel('   ', 2)).toBe('Color #2')
  })
})

describe('orderItemColorSuffix', () => {
  it('omits the suffix when there is no display_order', () => {
    expect(orderItemColorSuffix(null)).toBe('')
    expect(orderItemColorSuffix(undefined)).toBe('')
    expect(orderItemColorSuffix('')).toBe('')
  })

  it('adds the styled suffix when display_order exists', () => {
    expect(orderItemColorSuffix(4)).toBe(' ( Color #4 )')
    expect(orderItemColorSuffix('02')).toBe(' ( Color #02 )')
  })
})