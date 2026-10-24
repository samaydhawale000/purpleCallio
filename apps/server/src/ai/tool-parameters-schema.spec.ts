import {
  MAX_PROPERTIES,
  validateToolParametersSchema,
} from './tool-parameters-schema';

const valid = (schema: unknown) =>
  expect(validateToolParametersSchema(schema)).toEqual([]);
const invalid = (schema: unknown) =>
  expect(validateToolParametersSchema(schema).length).toBeGreaterThan(0);

describe('validateToolParametersSchema', () => {
  it('accepts the supported subset', () => {
    valid({ type: 'object' });
    valid({ type: 'object', properties: {} });
    valid({
      type: 'object',
      description: 'Order lookup',
      properties: {
        orderId: { type: 'string', description: 'The order id' },
        quantity: { type: 'integer' },
        price: { type: 'number', enum: [1.5, 2] },
        priority: { type: 'string', enum: ['low', 'high'] },
        gift: { type: 'boolean' },
      },
      required: ['orderId', 'quantity'],
    });
  });

  it('rejects a non-object root', () => {
    invalid(null);
    invalid([]);
    invalid('object');
    invalid({ type: 'string' });
    invalid({ properties: {} });
  });

  it('rejects unsupported keywords', () => {
    invalid({ type: 'object', $ref: '#/defs/x' });
    invalid({ type: 'object', additionalProperties: false });
    invalid({
      type: 'object',
      properties: { a: { type: 'string', pattern: '.*' } },
    });
  });

  it('rejects nested and array properties', () => {
    invalid({ type: 'object', properties: { a: { type: 'object' } } });
    invalid({
      type: 'object',
      properties: { a: { type: 'array', items: { type: 'string' } } },
    });
    invalid({ type: 'object', properties: { a: 'string' } });
    invalid({ type: 'object', properties: [] });
  });

  it('validates enums against the property type', () => {
    invalid({
      type: 'object',
      properties: { a: { type: 'string', enum: [] } },
    });
    invalid({
      type: 'object',
      properties: { a: { type: 'string', enum: [1] } },
    });
    invalid({
      type: 'object',
      properties: { a: { type: 'integer', enum: [1.5] } },
    });
    invalid({
      type: 'object',
      properties: { a: { type: 'boolean', enum: [true] } },
    });
    invalid({
      type: 'object',
      properties: { a: { type: 'string', enum: ['x', 'x'] } },
    });
  });

  it('requires required to list declared properties', () => {
    invalid({ type: 'object', properties: {}, required: ['missing'] });
    invalid({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: 'a',
    });
    invalid({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a', 'a'],
    });
  });

  it('rejects bad property names and oversized schemas', () => {
    invalid({ type: 'object', properties: { '1abc': { type: 'string' } } });
    invalid({ type: 'object', properties: { 'a-b': { type: 'string' } } });
    const many = Object.fromEntries(
      Array.from({ length: MAX_PROPERTIES + 1 }, (_, i) => [
        `p${i}`,
        { type: 'string' },
      ]),
    );
    invalid({ type: 'object', properties: many });
    invalid({ type: 'object', description: 'x'.repeat(20_000) });
  });
});
