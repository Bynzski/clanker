import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineInput } from '../../../src/main/agentBridge/input';
import { defineCapability } from '../../../src/main/agentBridge/capabilities';
import { AgentBridgeService, type AgentBridgeTerminalRecord } from '../../../src/main/agentBridge/service';

const spec = {
  confirm: { type: 'boolean', required: true },
  mode: { type: 'string', maxLength: 8, enum: ['keep', 'delete'] },
  note: { type: 'string', maxLength: 5, minLength: 1 },
  count: { type: 'integer', minimum: 1, maximum: 10 },
} as const;
const input = defineInput(spec);
const ok = (raw: unknown) => input.parse(raw);

describe('defineInput parser', () => {
  it('accepts exactly the declared shape and returns only declared, typed values', () => {
    expect(ok({ confirm: true, mode: 'keep', note: 'hi', count: 3 })).toEqual({ ok: true, value: { confirm: true, mode: 'keep', note: 'hi', count: 3 } });
    expect(ok({ confirm: false })).toEqual({ ok: true, value: { confirm: false } });
  });

  it.each([
    ['a missing required field', {}],
    ['a string where a boolean is required (no coercion)', { confirm: 'true' }],
    ['a number where a boolean is required', { confirm: 1 }],
    ['null for a required field', { confirm: null }],
    ['an undeclared field', { confirm: true, extra: 1 }],
    ['an enum value outside the set', { confirm: true, mode: 'purge' }],
    ['a non-string enum', { confirm: true, mode: 1 }],
    ['an over-long string', { confirm: true, note: 'abcdef' }],
    ['an under-length string', { confirm: true, note: '' }],
    ['an integer given as a string', { confirm: true, count: '5' }],
    ['a fractional integer', { confirm: true, count: 5.5 }],
    ['NaN', { confirm: true, count: Number.NaN }],
    ['Infinity', { confirm: true, count: Number.POSITIVE_INFINITY }],
    ['an unsafe integer', { confirm: true, count: 2 ** 60 }],
    ['an integer below range', { confirm: true, count: 0 }],
    ['an integer above range', { confirm: true, count: 11 }],
    ['a nested object where a value is required', { confirm: { value: true } }],
    ['an array value', { confirm: [true] }],
    ['an array instead of an object', [{ confirm: true }]],
    ['null instead of an object', null],
    ['a string instead of an object', 'confirm'],
  ])('refuses %s', (_label, raw) => {
    const result = ok(raw);
    expect(result.ok).toBe(false);
  });

  it('refuses prototype-shaped keys even when they arrive as own properties from JSON', () => {
    for (const body of ['{"confirm":true,"__proto__":{"admin":true}}', '{"confirm":true,"constructor":{}}', '{"confirm":true,"toString":1}']) {
      expect(ok(JSON.parse(body)).ok).toBe(false);
    }
  });

  it('does not inherit declared names from the prototype chain', () => {
    expect(ok(Object.create({ confirm: true })).ok).toBe(false);
  });

  it('treats absent arguments as an empty object', () => {
    expect(defineInput({}).parse(undefined)).toEqual({ ok: true, value: {} });
  });

  it('error text names the field and rule but never echoes the offending value', () => {
    const result = ok({ confirm: true, mode: 'SECRET-VALUE-123' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET-VALUE-123');
    expect(JSON.stringify(ok({ confirm: 'SECRET-VALUE-123' }))).not.toContain('SECRET-VALUE-123');
  });

  it('advertises exactly what it enforces: one declaration, one schema', () => {
    expect(input.jsonSchema).toEqual({
      type: 'object', additionalProperties: false, required: ['confirm'],
      properties: {
        confirm: { type: 'boolean' },
        mode: { type: 'string', maxLength: 8, enum: ['keep', 'delete'] },
        note: { type: 'string', maxLength: 5, minLength: 1 },
        count: { type: 'integer', minimum: 1, maximum: 10 },
      },
    });
    expect(Object.isFrozen(input.jsonSchema)).toBe(true);
  });

  it('refuses an unbounded declaration', () => {
    expect(() => defineInput({ s: { type: 'string', maxLength: Number.POSITIVE_INFINITY } })).toThrow(/bounded/);
    expect(() => defineInput({ n: { type: 'integer', minimum: 5, maximum: 1 } })).toThrow(/range/);
  });

  it.each([
    ['negative', -1], ['fractional', 2.5], ['NaN', Number.NaN], ['infinite', Number.POSITIVE_INFINITY],
    ['unsafe', 2 ** 60], ['greater than maxLength', 11],
  ])('refuses a %s minLength, which would advertise an invalid schema', (_label, minLength) => {
    expect(() => defineInput({ s: { type: 'string', maxLength: 10, minLength } })).toThrow(/minLength/);
  });

  it('accepts minLength from 0 up to and including maxLength', () => {
    expect(defineInput({ s: { type: 'string', maxLength: 10, minLength: 0 } }).jsonSchema.properties.s).toMatchObject({ minLength: 0 });
    expect(defineInput({ s: { type: 'string', maxLength: 10, minLength: 10 } }).jsonSchema.properties.s).toMatchObject({ minLength: 10 });
  });
});

describe('capability input is enforced before run()', () => {
  const terminals = new Map<string, AgentBridgeTerminalRecord>([['t1', { workspaceId: 'w1', checkoutContextId: 'w1::main', harnessId: 'claude' }]]);
  const run = vi.fn((value: { deleteBranch?: boolean; label: string }) => ({ data: { received: value } }));
  let service: AgentBridgeService;
  const grantFor = () => service.credentials.resolve(service.credentials.issue(
    { terminalId: 't1', workspaceId: 'w1', environmentId: 'local', checkoutContextId: 'w1::main', harnessId: 'claude' }, ['complete']).token)!;

  beforeEach(() => {
    run.mockClear();
    service = new AgentBridgeService({
      getRegistry: () => ({
        getWorkspace: () => ({ workspaceId: 'w1', location: { environmentId: 'local', path: '/p' } }),
        getCheckoutContext: () => ({ id: 'w1::main', workspaceId: 'w1', environmentId: 'local', path: '/p', kind: 'main' }),
      }) as never,
      getTerminals: () => terminals, version: () => '1',
      capabilities: [defineCapability({
        name: 'complete', description: 'd',
        input: { label: { type: 'string', maxLength: 10, required: true }, deleteBranch: { type: 'boolean' } },
        run,
      })],
    });
  });
  afterEach(() => service.shutdown());

  it.each([
    ['a stringly boolean for deleteBranch', { label: 'x', deleteBranch: 'true' }],
    ['a truthy number for deleteBranch', { label: 'x', deleteBranch: 1 }],
    ['a missing label', { deleteBranch: true }],
    ['an over-long label', { label: 'x'.repeat(11) }],
    ['an identity argument', { label: 'x', terminalId: 't2' }],
    ['a nested object', { label: { toString: 'x' } }],
  ])('rejects %s without ever executing the capability', async (_label, args) => {
    const result = await service.callTool(grantFor(), 'complete', args);
    expect(result.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('hands run() only validated, declared values', async () => {
    const result = await service.callTool(grantFor(), 'complete', { label: 'ok', deleteBranch: true });
    expect(result.isError).toBeUndefined();
    expect(run).toHaveBeenCalledWith({ label: 'ok', deleteBranch: true }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
