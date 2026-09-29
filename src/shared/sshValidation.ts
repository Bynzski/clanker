/**
 * SSH Target and Configuration Validation
 *
 * Validates SSH targets to reject option injection, control characters,
 * shell metacharacters, and malformed inputs.
 */

export interface SshTargetValidationResult {
  valid: boolean;
  target?: string;
  error?: string;
}

export function validateSshTarget(target: unknown): SshTargetValidationResult {
  if (typeof target !== 'string') {
    return { valid: false, error: 'SSH target must be a string' };
  }
  // Reject control characters (0x00-0x1F, 0x7F) including newlines/returns anywhere in input
  if (/[\x00-\x1f\x7f]/.test(target)) {
    return { valid: false, error: 'SSH target cannot contain control characters or newlines' };
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return { valid: false, error: 'SSH target cannot be empty' };
  }
  // Reject option injection: cannot start with '-'
  if (trimmed.startsWith('-')) {
    return { valid: false, error: 'SSH target cannot start with a hyphen' };
  }


  // Reject shell metacharacters and whitespace that should never appear in a host/target specification
  if (/[;&|`$<>(){}\\"'\s]/.test(trimmed)) {
    return { valid: false, error: 'SSH target cannot contain whitespace or shell metacharacters' };
  }

  return { valid: true, target: trimmed };
}

/** IDs are also prefixes in serialized workspace identities (`id::path`). */
export function isValidWorkspaceEnvironmentId(id: unknown): id is string {
  return typeof id === 'string'
    && id.trim().length > 0
    && !id.includes('::')
    && !id.includes('/')
    && !id.includes('\\');
}

export function validateSshEnvironmentConfig(input: unknown): { valid: true; config: { id: string; kind: 'ssh'; label: string; target: string } } | { valid: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'Invalid SSH environment configuration object' };
  }

  const record = input as Record<string, unknown>;
  if (!isValidWorkspaceEnvironmentId(record.id)) {
    return { valid: false, error: 'SSH environment ID is required and cannot contain "::" or path separators' };
  }

  const id = record.id.trim();
  if (id.toLowerCase() === 'local') {
    return { valid: false, error: 'Environment ID "local" is reserved for the local environment' };
  }

  if (typeof record.label !== 'string' || !record.label.trim()) {
    return { valid: false, error: 'SSH environment label is required' };
  }

  const targetValidation = validateSshTarget(record.target);
  if (!targetValidation.valid || !targetValidation.target) {
    return { valid: false, error: targetValidation.error || 'Invalid SSH target' };
  }

  return {
    valid: true,
    config: {
      id,
      kind: 'ssh',
      label: record.label.trim(),
      target: targetValidation.target,
    },
  };
}
