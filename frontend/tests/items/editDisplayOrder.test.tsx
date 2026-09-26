import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DisplayOrderField } from '../../app/(admin)/admin/items/edit/[id]/editVariantRow'

describe('DisplayOrderField (item edit variant row)', () => {
  it('keeps a null/blank display_order at a normal, bounded size', () => {
    // Variants with a null display_order send value "" — the field must stay a
    // compact fixed-width box (w-24) instead of stretching across the row.
    render(<DisplayOrderField value="" onChange={() => {}} />);

    const input = screen.getByRole('spinbutton');
    expect(input.getAttribute('value')).toBe('');
    expect(input.getAttribute('placeholder')).toBe('0');
    expect(input.className).toContain('w-24');
    expect(input.className).not.toContain('w-full');
  });

  it('keeps the same bounded layout when a display_order exists', () => {
    render(<DisplayOrderField value="7" onChange={() => {}} />);

    const input = screen.getByRole('spinbutton');
    expect(input.getAttribute('value')).toBe('7');
    expect(input.className).toContain('w-24');
    expect(input.className).not.toContain('w-full');
  });

  it('keeps the stored value nullable ("" for null) and propagates edits', () => {
    const onChange = vi.fn();
    render(<DisplayOrderField value="" onChange={onChange} />);

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '5' } });

    expect(onChange).toHaveBeenCalledWith('5');
    // The raw string is reported as-is; null mapping happens at save time only.
    expect(input.getAttribute('value')).toBe('');
  });
})