import { describe, expect, it } from 'vitest';
import { maskEmailAddress, maskEmailsInText } from '../../../src/renderer/lib/emailMask';

describe('email masking', () => {
  it('keeps the first character of the local part and the whole domain', () => {
    expect(maskEmailAddress('jaystabins@gmail.com')).toBe('j***@gmail.com');
    expect(maskEmailAddress('a@x.co')).toBe('a***@x.co');
  });

  it('masks every address inside display text and leaves the rest untouched', () => {
    expect(maskEmailsInText('Codex plus · jaystabins@gmail.com (also ops@corp.example.org)'))
      .toBe('Codex plus · j***@gmail.com (also o***@corp.example.org)');
    expect(maskEmailsInText('Usage · 5 hour')).toBe('Usage · 5 hour');
  });

  it('does not treat host-style targets without a dotted domain as addresses', () => {
    expect(maskEmailsInText('jay@server resets in 3.5h')).toBe('jay@server resets in 3.5h');
  });
});
