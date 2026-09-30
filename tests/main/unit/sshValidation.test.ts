import { describe, it, expect } from 'vitest';
import { validateSshTarget, validateSshEnvironmentConfig } from '../../../src/shared/sshValidation';

describe('sshValidation', () => {
  describe('validateSshTarget', () => {
    it('accepts valid hostnames and targets', () => {
      expect(validateSshTarget('example.com').valid).toBe(true);
      expect(validateSshTarget('user@example.com').valid).toBe(true);
      expect(validateSshTarget('192.168.1.50').valid).toBe(true);
      expect(validateSshTarget('deploy@10.0.0.1').valid).toBe(true);
      expect(validateSshTarget('my-dev-vps.internal').valid).toBe(true);
      expect(validateSshTarget('tailscale-node').valid).toBe(true);
    });

    it('rejects option injection attacks starting with -', () => {
      const res1 = validateSshTarget('-oProxyCommand=calc.exe');
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain('cannot start with a hyphen');

      const res2 = validateSshTarget('-F/tmp/evil.conf');
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain('cannot start with a hyphen');
    });

    it('rejects control characters and newlines', () => {
      expect(validateSshTarget('host\x00evil').valid).toBe(false);
      expect(validateSshTarget('host\nsecond-command').valid).toBe(false);
      expect(validateSshTarget('host\r').valid).toBe(false);
    });

    it('rejects shell metacharacters and whitespace', () => {
      expect(validateSshTarget('host; rm -rf /').valid).toBe(false);
      expect(validateSshTarget('host && echo evil').valid).toBe(false);
      expect(validateSshTarget('host | cat').valid).toBe(false);
      expect(validateSshTarget('host`id`').valid).toBe(false);
      expect(validateSshTarget('host$(id)').valid).toBe(false);
      expect(validateSshTarget('host>out').valid).toBe(false);
      expect(validateSshTarget('host<in').valid).toBe(false);
      expect(validateSshTarget('host space').valid).toBe(false);
    });

    it('rejects empty or non-string targets', () => {
      expect(validateSshTarget('').valid).toBe(false);
      expect(validateSshTarget('   ').valid).toBe(false);
      expect(validateSshTarget(null).valid).toBe(false);
      expect(validateSshTarget(123).valid).toBe(false);
    });
  });

  describe('validateSshEnvironmentConfig', () => {
    const config = { id: 'host', label: 'Host', target: 'host' };
    it('keeps an absolute remote default root and omits a cleared root', () => {
      expect(validateSshEnvironmentConfig({ ...config, defaultWorkspaceRoot: ' /srv/my repos/ ' })).toMatchObject({ valid: true, config: { defaultWorkspaceRoot: '/srv/my repos/' } });
      const cleared = validateSshEnvironmentConfig({ ...config, defaultWorkspaceRoot: '  ' });
      expect(cleared.valid).toBe(true);
      if (cleared.valid) expect(cleared.config).not.toHaveProperty('defaultWorkspaceRoot');
    });
    it.each(['repos', '~/repos', '$HOME/repos', 'C:\\repos', '/srv\\repos', '/srv\nrepos', '/srv\0repos', '/srv\t', null, 12, '/'+ 'ü'.repeat(2048)])('rejects invalid remote default root %j', (defaultWorkspaceRoot) => {
      expect(validateSshEnvironmentConfig({ ...config, defaultWorkspaceRoot }).valid).toBe(false);
    });
    it('validates a complete and correct config', () => {
      const res = validateSshEnvironmentConfig({
        id: 'vps-1',
        kind: 'ssh',
        label: 'Production VPS',
        target: 'deploy@vps.com',
      });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.config).toEqual({
          id: 'vps-1',
          kind: 'ssh',
          label: 'Production VPS',
          target: 'deploy@vps.com',
        });
      }
    });

    it('rejects invalid or incomplete configs', () => {
      expect(validateSshEnvironmentConfig(null).valid).toBe(false);
      expect(validateSshEnvironmentConfig({}).valid).toBe(false);
      expect(validateSshEnvironmentConfig({ id: '', label: 'L', target: 'host' }).valid).toBe(false);
      expect(validateSshEnvironmentConfig({ id: '1', label: '', target: 'host' }).valid).toBe(false);
      expect(validateSshEnvironmentConfig({ id: '1', label: 'L', target: '-bad' }).valid).toBe(false);
    });
  });
});
