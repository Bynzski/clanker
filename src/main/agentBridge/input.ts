/**
 * Executable tool-input definitions. One declaration yields BOTH the JSON Schema advertised to the
 * model and the parser that enforces it, so the advertised contract cannot drift from the enforced
 * one and a capability's `run()` only ever receives validated, typed input.
 *
 * Deliberately small: flat, closed objects of booleans, bounded strings (optionally enums) and bounded
 * integers. There is no coercion, no nesting and no defaults; anything undeclared, missing, mistyped or
 * out of range is refused before a capability executes. A capability that genuinely needs more shape
 * should add it here (with tests) rather than parse raw JSON itself.
 */

export type InputField =
  | { readonly type: 'boolean'; readonly description?: string; readonly required?: boolean }
  | { readonly type: 'string'; readonly maxLength: number; readonly minLength?: number; readonly enum?: readonly string[]; readonly description?: string; readonly required?: boolean }
  | { readonly type: 'integer'; readonly minimum: number; readonly maximum: number; readonly description?: string; readonly required?: boolean };

export type InputSpec = Readonly<Record<string, InputField>>;

type FieldValue<F extends InputField> = F extends { type: 'boolean' } ? boolean
  : F extends { type: 'string'; enum: readonly (infer E)[] } ? E
  : F extends { type: 'string' } ? string
  : number;
type RequiredKeys<S extends InputSpec> = { [K in keyof S]: S[K] extends { required: true } ? K : never }[keyof S];
/** Required fields are present; the rest are optional. */
export type InferInput<S extends InputSpec> =
  { [K in RequiredKeys<S>]: FieldValue<S[K]> } & { [K in Exclude<keyof S, RequiredKeys<S>>]?: FieldValue<S[K]> };

export interface ToolJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export interface InputDefinition<T> {
  readonly jsonSchema: ToolJsonSchema;
  /** Never throws. Error text names the field and the rule, never the offending value. */
  parse(raw: unknown): ParseResult<T>;
}

const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

export function defineInput<const S extends InputSpec>(spec: S): InputDefinition<InferInput<S>> {
  const names = Object.keys(spec);
  for (const name of names) {
    const field = spec[name];
    if (field.type === 'string' && (!Number.isSafeInteger(field.maxLength) || field.maxLength < 0)) throw new Error(`Input "${name}" needs a bounded maxLength`);
    if (field.type === 'string' && field.minLength !== undefined
      && !(Number.isSafeInteger(field.minLength) && field.minLength >= 0 && field.minLength <= field.maxLength)) {
      throw new Error(`Input "${name}" needs a minLength that is a safe integer between 0 and maxLength`);
    }
    if (field.type === 'integer' && !(Number.isSafeInteger(field.minimum) && Number.isSafeInteger(field.maximum) && field.minimum <= field.maximum)) {
      throw new Error(`Input "${name}" needs a safe integer range`);
    }
  }
  const required = names.filter((name) => spec[name].required === true);
  const properties = Object.fromEntries(names.map((name) => {
    const field = spec[name];
    const base = { type: field.type, ...(field.description ? { description: field.description } : {}) };
    if (field.type === 'string') {
      return [name, { ...base, maxLength: field.maxLength, ...(field.minLength !== undefined ? { minLength: field.minLength } : {}), ...(field.enum ? { enum: [...field.enum] } : {}) }];
    }
    if (field.type === 'integer') return [name, { ...base, minimum: field.minimum, maximum: field.maximum }];
    return [name, base];
  }));
  const jsonSchema: ToolJsonSchema = Object.freeze({
    type: 'object', properties: Object.freeze(properties), ...(required.length ? { required: Object.freeze(required) } : {}), additionalProperties: false,
  });

  return {
    jsonSchema,
    parse(raw) {
      if (raw === undefined) raw = {};
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Arguments must be an object' };
      const input = raw as Record<string, unknown>;
      // Own keys only: undeclared (including `__proto__`/`constructor`) is refused, never ignored.
      for (const key of Object.keys(input)) if (!has(spec, key)) return { ok: false, error: 'Unexpected arguments' };
      const value: Record<string, unknown> = {};
      for (const name of names) {
        const field = spec[name];
        if (!has(input, name) || input[name] === undefined) {
          if (field.required === true) return { ok: false, error: `Missing required argument: ${name}` };
          continue;
        }
        const item = input[name];
        if (field.type === 'boolean') {
          if (typeof item !== 'boolean') return { ok: false, error: `Argument ${name} must be a boolean` };
        } else if (field.type === 'string') {
          if (typeof item !== 'string') return { ok: false, error: `Argument ${name} must be a string` };
          if (item.length > field.maxLength) return { ok: false, error: `Argument ${name} is too long` };
          if (item.length < (field.minLength ?? 0)) return { ok: false, error: `Argument ${name} is too short` };
          if (field.enum && !field.enum.includes(item)) return { ok: false, error: `Argument ${name} is not an allowed value` };
        } else {
          if (typeof item !== 'number' || !Number.isSafeInteger(item)) return { ok: false, error: `Argument ${name} must be an integer` };
          if (item < field.minimum || item > field.maximum) return { ok: false, error: `Argument ${name} is out of range` };
        }
        value[name] = item;
      }
      return { ok: true, value: value as InferInput<InputSpec> as never };
    },
  };
}
