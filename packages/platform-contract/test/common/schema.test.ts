import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  arr,
  bool,
  enum_,
  num,
  nullable,
  obj,
  optional,
  rec,
  str,
} from '../../src/common/schema.js';

describe('schema primitives', () => {
  it('emits JSON Schema for a string primitive', () => {
    expect(str(3, 40).openapi).toEqual({ type: 'string', minLength: 3, maxLength: 40 });
  });

  it('emits JSON Schema for a boolean primitive', () => {
    expect(bool().openapi).toEqual({ type: 'boolean' });
  });

  it('validates values with the zod schema', () => {
    expect(str(3, 40).zod.safeParse('abc').success).toBe(true);
    expect(str(3, 40).zod.safeParse('ab').success).toBe(false);
  });

  it('emits closed vs open enums via meta', () => {
    const closed = enum_(['a', 'b']);
    expect(closed.openapi.enum).toEqual(['a', 'b']);
    expect(closed.meta.openEnum).toBeUndefined();
    const open = enum_(['a', 'b'], { openEnum: true });
    expect(open.meta.openEnum).toBe(true);
  });

  it('composes objects, arrays, records, nullable, optional, union', () => {
    const def = obj({
      name: str(1, 10),
      tags: arr(str(1, 5)),
      counts: rec(num(0)),
      maybe: nullable(str(1, 5)),
      extra: optional(str(1, 5)),
    });
    expect(def.zod.safeParse({ name: 'a', tags: [], counts: {}, maybe: null }).success).toBe(true);
    expect(def.zod.safeParse({ name: 'a', tags: [], counts: {} }).success).toBe(false);
    expect(
      def.zod.safeParse({ name: 'a', tags: ['x'], counts: { k: 1 }, maybe: 'y', extra: 'z' })
        .success,
    ).toBe(true);
    expect(def.zod.safeParse({ name: 'a', tags: [''], counts: {}, maybe: null }).success).toBe(
      false,
    );
    expect(def.openapi.properties).toBeDefined();
  });

  it('derives obj required keys from zod-requiredness, excluding optional keys', () => {
    const def = obj({ name: str(1, 10), extra: optional(str(1, 5)) });
    expect(def.openapi.required).toEqual(['name']);
    expect(def.zod.safeParse({ name: 'x' }).success).toBe(true);
    expect(def.zod.safeParse({}).success).toBe(false);
  });

  it('keeps nullable keys in obj required (nullable is not optional)', () => {
    const def = obj({ name: str(1, 10), maybe: nullable(str(1, 5)) });
    expect(def.openapi.required).toEqual(['name', 'maybe']);
    expect(def.zod.safeParse({ name: 'x', maybe: null }).success).toBe(true);
    expect(def.zod.safeParse({ name: 'x' }).success).toBe(false);
  });

  it('emits OpenAPI 3.1 nullable unions instead of the draft-04 nullable key', () => {
    const def = nullable(str(1, 5));
    expect(def.openapi.type).toEqual(['string', 'null']);
    expect(def.openapi).not.toHaveProperty('nullable');
    expect(def.openapi.minLength).toBe(1);
    expect(def.zod.safeParse(null).success).toBe(true);
    expect(def.zod.safeParse('x').success).toBe(true);
    expect(def.zod.safeParse(3).success).toBe(false);
  });

  it('wraps an object type in a nullable union and drops nullable', () => {
    const def = nullable(obj({ name: str(1, 5) }));
    expect(def.openapi.type).toEqual(['object', 'null']);
    expect(def.openapi).not.toHaveProperty('nullable');
    expect(def.openapi.properties).toBeDefined();
    expect(def.zod.safeParse({ name: 'x' }).success).toBe(true);
    expect(def.zod.safeParse(null).success).toBe(true);
  });

  it('appends null to an existing type array without duplicating', () => {
    const union = nullable({
      zod: z.union([z.string(), z.number()]),
      openapi: { type: ['string', 'number'] },
      meta: {},
    });
    expect(union.openapi.type).toEqual(['string', 'number', 'null']);
    const already = nullable({
      zod: z.nullable(z.string()),
      openapi: { type: ['string', 'null'] },
      meta: {},
    });
    expect(already.openapi.type).toEqual(['string', 'null']);
  });

  it('leaves an undefined type untouched and still drops nullable', () => {
    const def = nullable({
      zod: z.any(),
      openapi: { enum: ['a', 'b'], nullable: true },
      meta: {},
    });
    expect(def.openapi.type).toBeUndefined();
    expect(def.openapi).not.toHaveProperty('nullable');
    expect(def.openapi.enum).toEqual(['a', 'b']);
    expect(def.zod.safeParse(null).success).toBe(true);
  });

  it('builds a number without bounds when no args are given', () => {
    const def = num();
    expect(def.openapi).toEqual({ type: 'number' });
    expect(def.zod.safeParse(0).success).toBe(true);
    expect(def.zod.safeParse(-5).success).toBe(true);
  });

  it('builds a partial object when requiredAll is false', () => {
    const def = obj({ name: str(1, 10), extra: str(1, 5) }, false);
    expect(def.openapi.type).toEqual('object');
    expect(def.openapi.required).toBeUndefined();
    expect(def.zod.safeParse({}).success).toBe(true);
    expect(def.zod.safeParse({ name: 'x' }).success).toBe(true);
  });
});
