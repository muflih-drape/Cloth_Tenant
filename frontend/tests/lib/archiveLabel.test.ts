import { describe, it, expect } from 'vitest'
import { archiveCountdownLabel } from '../../util/archiveLabel'

describe('archiveCountdownLabel', () => {
  it('says "Deletes today" at 0 days', () => {
    expect(archiveCountdownLabel(0)).toBe('Deletes today')
  })

  it('uses singular at 1 day', () => {
    expect(archiveCountdownLabel(1)).toBe('Deletes in 1 day')
  })

  it('uses plural at 7 and 8 days', () => {
    expect(archiveCountdownLabel(7)).toBe('Deletes in 7 days')
    expect(archiveCountdownLabel(8)).toBe('Deletes in 8 days')
  })

  it('clamps negative values to "Deletes today"', () => {
    expect(archiveCountdownLabel(-2)).toBe('Deletes today')
  })
})