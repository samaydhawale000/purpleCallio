/**
 * Validator for a tool's parametersSchema. Only a restricted JSON-Schema
 * subset is accepted, so every provider can represent it:
 *
 *   { type: 'object', description?, properties: { [name]: Prop }, required?: string[] }
 *   Prop = { type: 'string' | 'number' | 'integer' | 'boolean', description?, enum? }
 *
 * No nesting, refs, arrays or other keywords.
 */

export const PROPERTY_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
export const MAX_PROPERTIES = 32;
export const MAX_ENUM_VALUES = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_SCHEMA_BYTES = 16 * 1024;

const ROOT_KEYS = new Set(['type', 'description', 'properties', 'required']);
const PROPERTY_KEYS = new Set(['type', 'description', 'enum']);
const PROPERTY_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkDescription(value: unknown, path: string, errors: string[]) {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `${path}.description must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
}

function enumValueMatches(type: string, value: unknown): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && isFinite(value);
  return false;
}

function checkProperty(name: string, prop: unknown, errors: string[]): void {
  const path = `properties.${name}`;
  if (!PROPERTY_NAME.test(name)) {
    errors.push(`${path}: invalid property name`);
  }
  if (!isPlainObject(prop)) {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of Object.keys(prop)) {
    if (!PROPERTY_KEYS.has(key)) errors.push(`${path}.${key} is not supported`);
  }
  const type = prop.type;
  if (typeof type !== 'string' || !PROPERTY_TYPES.has(type)) {
    errors.push(`${path}.type must be one of string, number, integer, boolean`);
    return;
  }
  checkDescription(prop.description, path, errors);
  if (prop.enum !== undefined) {
    const values = prop.enum;
    if (
      type === 'boolean' ||
      !Array.isArray(values) ||
      values.length === 0 ||
      values.length > MAX_ENUM_VALUES ||
      !values.every((v) => enumValueMatches(type, v)) ||
      new Set(values).size !== values.length
    ) {
      errors.push(
        `${path}.enum must be 1-${MAX_ENUM_VALUES} unique values of type ${type}`,
      );
    }
  }
}

/** Returns a list of problems; an empty list means the schema is accepted. */
export function validateToolParametersSchema(schema: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(schema)) return ['schema must be an object'];

  if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) {
    return [`schema must be at most ${MAX_SCHEMA_BYTES} bytes`];
  }
  for (const key of Object.keys(schema)) {
    if (!ROOT_KEYS.has(key)) errors.push(`${key} is not supported`);
  }
  if (schema.type !== 'object') errors.push('type must be "object"');
  checkDescription(schema.description, 'schema', errors);

  const properties = schema.properties ?? {};
  if (!isPlainObject(properties)) {
    errors.push('properties must be an object');
    return errors;
  }
  const names = Object.keys(properties);
  if (names.length > MAX_PROPERTIES) {
    errors.push(`at most ${MAX_PROPERTIES} properties are allowed`);
  }
  for (const name of names) checkProperty(name, properties[name], errors);

  if (schema.required !== undefined) {
    const required = schema.required;
    if (
      !Array.isArray(required) ||
      !required.every((r) => typeof r === 'string' && names.includes(r)) ||
      new Set(required).size !== required.length
    ) {
      errors.push('required must list unique, declared property names');
    }
  }
  return errors;
}

export const MAX_ARGUMENT_STRING_LENGTH = 4096;

function argumentMatches(type: unknown, value: unknown): boolean {
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') {
    return (
      typeof value === 'string' && value.length <= MAX_ARGUMENT_STRING_LENGTH
    );
  }
  return enumValueMatches(String(type), value);
}

/**
 * Checks a model's tool-call arguments against a schema that passed
 * validateToolParametersSchema. Messages name properties only, never
 * values, so they are safe to log and to hand back to the model.
 */
export function validateToolArguments(
  schema: unknown,
  args: unknown,
): string[] {
  if (!isPlainObject(args)) return ['arguments must be an object'];
  if (!isPlainObject(schema)) return ['tool schema is invalid'];
  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  const errors: string[] = [];
  for (const name of required) {
    if (args[name] === undefined || args[name] === null) {
      errors.push(`${name} is required`);
    }
  }
  for (const [name, value] of Object.entries(args)) {
    const prop = properties[name];
    if (!isPlainObject(prop)) {
      errors.push(`${name} is not a known argument`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (!argumentMatches(prop.type, value)) {
      errors.push(`${name} must be a ${String(prop.type)}`);
    } else if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      errors.push(`${name} must be one of the allowed values`);
    }
  }
  return errors;
}
