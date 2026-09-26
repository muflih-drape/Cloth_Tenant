import { describe, it, expect } from 'vitest'
import { objectToFormData, itemToFormData } from '../../lib/form-utils'

describe('objectToFormData', () => {
  it('converts a simple key-value object', () => {
    const result = objectToFormData({ name: 'Test', age: 25 })
    expect(result.get('name')).toBe('Test')
    expect(result.get('age')).toBe('25')
  })

  it('handles nested objects with bracket notation', () => {
    const result = objectToFormData({
      user: { name: 'John', email: 'john@example.com' }
    })
    expect(result.get('user[name]')).toBe('John')
    expect(result.get('user[email]')).toBe('john@example.com')
  })

  it('handles arrays with index notation', () => {
    const result = objectToFormData({
      items: ['apple', 'banana', 'cherry']
    })
    expect(result.get('items[0]')).toBe('apple')
    expect(result.get('items[1]')).toBe('banana')
    expect(result.get('items[2]')).toBe('cherry')
  })

  it('handles nested arrays in objects', () => {
    const result = objectToFormData({
      variants: [
        { sizes: ['S', 'M', 'L'] },
        { sizes: ['XL', 'XXL'] }
      ]
    })
    expect(result.get('variants[0][sizes][0]')).toBe('S')
    expect(result.get('variants[0][sizes][1]')).toBe('M')
    expect(result.get('variants[1][sizes][0]')).toBe('XL')
  })

  it('skips null and undefined values', () => {
    const result = objectToFormData({
      name: 'Test',
      empty: null,
      alsoEmpty: undefined
    })
    expect(result.get('name')).toBe('Test')
    expect(result.get('empty')).toBeNull()
    expect(result.get('alsoEmpty')).toBeNull()
  })

  it('respects ignoreList parameter', () => {
    const result = objectToFormData(
      { name: 'Test', secret: 'hidden', password: '123' },
      undefined,
      ['secret', 'password']
    )
    expect(result.get('name')).toBe('Test')
    expect(result.get('secret')).toBeNull()
    expect(result.get('password')).toBeNull()
  })

  it('handles File objects', () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })
    const result = objectToFormData({ file })
    expect(result.get('file')).toBe(file)
  })

  it('handles empty objects', () => {
    const result = objectToFormData({})
    expect(Array.from(result.entries()).length).toBe(0)
  })

  it('handles empty arrays', () => {
    const result = objectToFormData({ items: [] })
    expect(Array.from(result.entries()).length).toBe(0)
  })
})

describe('itemToFormData', () => {
  it('converts item structure to Django FormData', () => {
    const item = {
      name: 'T-Shirt',
      description: 'Comfortable cotton t-shirt',
      price: '29.99',
      type: 'apparel',
      variants: [
        {
          image: null,
          sizes: [
            { size: 'S', stock: 10 },
            { size: 'M', stock: 15 }
          ]
        },
        {
          image: null,
          sizes: [
            { size: 'L', stock: 8 }
          ]
        }
      ]
    }

    const result = itemToFormData(item)
    expect(result.get('name')).toBe('T-Shirt')
    expect(result.get('description')).toBe('Comfortable cotton t-shirt')
    expect(result.get('price')).toBe('29.99')
    expect(result.get('type')).toBe('apparel')
    expect(result.get('variants[0]sizes[0]size')).toBe('S')
    expect(result.get('variants[0]sizes[0]stock')).toBe('10')
    expect(result.get('variants[0]sizes[1]size')).toBe('M')
    expect(result.get('variants[0]sizes[1]stock')).toBe('15')
    expect(result.get('variants[1]sizes[0]size')).toBe('L')
    expect(result.get('variants[1]sizes[0]stock')).toBe('8')
  })

  it('handles variant with image file', () => {
    const file = new File(['image'], 'red.png', { type: 'image/png' })
    const item = {
      name: 'Shirt',
      description: '',
      price: '19.99',
      type: 'apparel',
      variants: [
        {
          image: file,
          sizes: [{ size: 'M', stock: 5 }]
        }
      ]
    }

    const result = itemToFormData(item)
    expect(result.get('variants[0]image')).toBe(file)
  })

  it('uses empty string for missing description', () => {
    const item = {
      name: 'Item',
      description: undefined,
      price: '10',
      type: 'other',
      variants: []
    }

    const result = itemToFormData(item)
    expect(result.get('description')).toBe('')
  })
})
