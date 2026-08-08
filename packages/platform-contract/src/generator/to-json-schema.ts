import type { JsonSchemaObject, SchemaDef } from '../common/schema.js';

export interface SchemaRegistry {
  readonly register: (name: string, schema: JsonSchemaObject) => void;
  readonly read: () => Readonly<Record<string, JsonSchemaObject>>;
}

export function toJsonSchema(
  def: SchemaDef,
  registry: SchemaRegistry,
  name?: string,
): JsonSchemaObject {
  if (name !== undefined) {
    registry.register(name, def.openapi);
    return { $ref: `#/components/schemas/${name}` };
  }
  return def.openapi;
}
