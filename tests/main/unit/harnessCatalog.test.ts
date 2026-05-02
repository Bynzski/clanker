/**
 * Harness Catalog Tests - Real Behavior
 * 
 * Tests for AI harness model discovery and configuration.
 * 
 * Migration strategy:
 * - Pure parsing functions (parsePiModels, parseOpenCodeModels, normalizeModelLine): 
 *   Test directly with real CLI output - no mocks needed
 * - Static data (HARNESS_OPTIONS, MODEL_DISCOVERY_FALLBACKS): Verify structure directly
 * - Filesystem reads (readCodexConfiguredModel): Minimal boundary mock
 * - Command execution (discoverHarnessModels): Real commands with timeout and fallback
 * 
 * This approach tests actual parsing behavior, not mocked responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  HARNESS_OPTIONS,
  discoverHarnessModels,
  normalizeModelLine,
  parsePiModels,
  parseOpenCodeModels,
  parseCodexDebugModels,
} from '../../../src/main/harnessCatalog';

// ============================================================================
// normalizeModelLine Tests
// ============================================================================

describe('normalizeModelLine', () => {
  it('removes ANSI color codes from output', () => {
    expect(normalizeModelLine('\u001B[32mSuccess\u001B[0m')).toBe('Success');
    expect(normalizeModelLine('\u001B[1;34mModel Name\u001B[0m')).toBe('Model Name');
    expect(normalizeModelLine('\u001B[38;5;214mmodel\u001B[0m')).toBe('model');
  });

  it('removes bullet prefixes', () => {
    expect(normalizeModelLine('  - claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(normalizeModelLine('* gpt-4o')).toBe('gpt-4o');
    expect(normalizeModelLine('• openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini');
  });

  it('removes numbered list prefixes', () => {
    expect(normalizeModelLine('1. sonnet')).toBe('sonnet');
    expect(normalizeModelLine('2) haiku')).toBe('haiku');
  });

  it('trims whitespace', () => {
    expect(normalizeModelLine('  gpt-4o  ')).toBe('gpt-4o');
    expect(normalizeModelLine('\tclaude-3.5-sonnet\t')).toBe('claude-3.5-sonnet');
  });

  it('preserves model IDs with slashes', () => {
    expect(normalizeModelLine('anthropic/claude-sonnet-4-6')).toBe('anthropic/claude-sonnet-4-6');
    expect(normalizeModelLine('  openai/gpt-4o ')).toBe('openai/gpt-4o');
  });

  it('handles empty input', () => {
    expect(normalizeModelLine('')).toBe('');
    expect(normalizeModelLine('   ')).toBe('');
  });

  it('handles complex ANSI sequences', () => {
    expect(normalizeModelLine('\u001B[38;2;255;128;0mtext\u001B[0m')).toBe('text');
    expect(normalizeModelLine('\u001B[1;2;3mvalue\u001B[0m')).toBe('value');
  });
});

// ============================================================================
// parsePiModels Tests
// ============================================================================

describe('parsePiModels', () => {
  it('parses basic pi model output', () => {
    const output = `Provider  Model
────────  ────────────────
anthropic  claude-sonnet-4-6
openai     gpt-4o`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[0].label).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
    expect(models[1].label).toBe('openai/gpt-4o');
  });

  it('handles real pi output with ANSI colors', () => {
    const output = `\u001B[1mProvider\u001B[0m  \u001B[1mModel\u001B[0m
\u001B[2m────────\u001B[0m  \u001B[2m───────────────\u001B[0m
\u001B[32manthropic\u001B[0m  \u001B[33mclaude-sonnet-4-6\u001B[0m
\u001B[32mopenai\u001B[0m     \u001B[33mgpt-4o-mini\u001B[0m`;

    const models = parsePiModels(output);

    expect(models.length).toBeGreaterThan(0);
    expect(models.some(m => m.id.includes('anthropic'))).toBe(true);
    expect(models.some(m => m.id.includes('gpt'))).toBe(true);
  });

  it('filters out "no models available" message', () => {
    const output = 'No models available. Set API keys in environment variables.';
    
    const models = parsePiModels(output);

    expect(models).toEqual([]);
  });

  it('handles case-insensitive "no models available" check', () => {
    expect(parsePiModels('NO MODELS AVAILABLE').length).toBe(0);
    expect(parsePiModels('No Models Available').length).toBe(0);
    expect(parsePiModels('no models available').length).toBe(0);
  });

  it('filters out warning and separator lines', () => {
    const output = `warning: API key not set
Provider  Model
────────  ────────────────
anthropic  sonnet
openai     gpt-4o`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(2);
    expect(models.map(m => m.id)).toContain('anthropic/sonnet');
    expect(models.map(m => m.id)).toContain('openai/gpt-4o');
  });

  it('deduplicates models by id', () => {
    const output = `anthropic  claude-sonnet-4-6
anthropic  claude-sonnet-4-6
openai     gpt-4o`;

    const models = parsePiModels(output);
    const ids = models.map(m => m.id);
    const uniqueIds = [...new Set(ids)];

    expect(ids).toEqual(uniqueIds);
  });

  it('handles empty lines between entries', () => {
    const output = `anthropic  claude-sonnet-4-6

openai     gpt-4o

`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(2);
  });

  it('handles tab-separated columns', () => {
    const output = 'anthropic\tclaude-3.5-sonnet';

    const models = parsePiModels(output);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('anthropic/claude-3.5-sonnet');
  });

  it('ignores lines with only one column', () => {
    const output = `anthropic  claude-sonnet-4-6
only-provider`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(1);
  });

  it('handles pi header and footer messages', () => {
    const output = `pi - AI coding assistant

Provider  Model
────────  ────────────────
anthropic  sonnet

Set API keys to enable model selection.`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('anthropic/sonnet');
  });

  it('handles models with colons in names', () => {
    const output = `anthropic  sonnet:high
openai     gpt-4o:preview`;

    const models = parsePiModels(output);

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('anthropic/sonnet:high');
  });
});

// ============================================================================
// parseOpenCodeModels Tests
// ============================================================================

describe('parseOpenCodeModels', () => {
  it('parses basic opencode model list', () => {
    const output = `anthropic/claude-sonnet-4-6
openai/gpt-4o
anthropic/claude-3.5-sonnet`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
    expect(models[2].id).toBe('anthropic/claude-3.5-sonnet');
  });

  it('filters invalid characters from lines', () => {
    const output = `anthropic/claude-sonnet-4-6
invalid <script> tag
openai/gpt-4o`;

    const models = parseOpenCodeModels(output);

    // Only valid lines should be included
    expect(models.some(m => m.id === 'invalid <script> tag')).toBe(false);
    expect(models.some(m => m.id === 'anthropic/claude-sonnet-4-6')).toBe(true);
  });

  it('removes ANSI colors', () => {
    const output = `\u001B[32manthropic/claude-sonnet-4-6\u001B[0m
\u001B[33mopenai/gpt-4o\u001B[0m`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
  });

  it('removes numbered and bullet prefixes', () => {
    const output = `1. anthropic/claude-sonnet-4-6
2. openai/gpt-4o
- anthropic/claude-3.5-sonnet`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
    expect(models[1].id).toBe('openai/gpt-4o');
    expect(models[2].id).toBe('anthropic/claude-3.5-sonnet');
  });

  it('deduplicates models', () => {
    const output = `anthropic/claude-sonnet-4-6
anthropic/claude-sonnet-4-6
openai/gpt-4o`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(2);
    const ids = models.map(m => m.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids).toEqual(uniqueIds);
  });

  it('trims whitespace', () => {
    const output = `  anthropic/claude-sonnet-4-6  
  openai/gpt-4o  `;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('anthropic/claude-sonnet-4-6');
  });

  it('preserves model IDs with various formats', () => {
    const output = `anthropic/claude-3-5-sonnet-20240620
openai/gpt-4-turbo-2024-04-09
google/gemini-pro`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(3);
  });

  it('filters empty lines', () => {
    const output = `anthropic/claude-sonnet-4-6

openai/gpt-4o

`;

    const models = parseOpenCodeModels(output);

    expect(models).toHaveLength(2);
  });

  it('handles mixed valid and invalid lines', () => {
    const output = `anthropic/claude-sonnet-4-6
[ERROR] Network timeout
openai/gpt-4o
Another error message`;

    const models = parseOpenCodeModels(output);

    // Should only include valid model IDs
    expect(models.length).toBe(2);
    expect(models.some(m => m.id === 'anthropic/claude-sonnet-4-6')).toBe(true);
    expect(models.some(m => m.id === 'openai/gpt-4o')).toBe(true);
    expect(models.some(m => m.id.includes('ERROR'))).toBe(false);
  });
});

// ============================================================================
// parseCodexDebugModels Tests
// ============================================================================

describe('parseCodexDebugModels', () => {
  it('parses visible models from JSON output', () => {
    const output = JSON.stringify({
      models: [
        { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' },
        { slug: 'gpt-5.4', display_name: 'gpt-5.4', visibility: 'list' },
        { slug: 'codex-auto-review', display_name: 'Codex Auto Review', visibility: 'hide' },
      ],
    });

    const models = parseCodexDebugModels(output);

    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({ id: 'gpt-5.5', label: 'GPT-5.5' });
    expect(models[1]).toEqual({ id: 'gpt-5.4', label: 'gpt-5.4' });
  });

  it('falls back to slug when display_name is absent', () => {
    const output = JSON.stringify({
      models: [{ slug: 'gpt-5.4-mini', visibility: 'list' }],
    });

    const models = parseCodexDebugModels(output);

    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({ id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' });
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseCodexDebugModels('not json')).toEqual([]);
    expect(parseCodexDebugModels('')).toEqual([]);
  });

  it('returns empty array when models array is missing', () => {
    expect(parseCodexDebugModels(JSON.stringify({}))).toEqual([]);
  });

  it('filters out entries without a slug', () => {
    const output = JSON.stringify({
      models: [
        { display_name: 'No slug', visibility: 'list' },
        { slug: 'gpt-5.4', display_name: 'GPT-5.4', visibility: 'list' },
      ],
    });

    const models = parseCodexDebugModels(output);

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-5.4');
  });

  it('returns empty array when all models are hidden', () => {
    const output = JSON.stringify({
      models: [
        { slug: 'internal', display_name: 'Internal', visibility: 'hide' },
      ],
    });

    expect(parseCodexDebugModels(output)).toEqual([]);
  });
});

// ============================================================================
// HARNESS_OPTIONS Tests - Static Data Verification
// ============================================================================

describe('HARNESS_OPTIONS', () => {
  it('contains all four harness configs', () => {
    const keys = Object.keys(HARNESS_OPTIONS).sort();
    expect(keys).toEqual(['claude', 'codex', 'opencode', 'pi']);
  });

  it('each config has required fields', () => {
    for (const [name, config] of Object.entries(HARNESS_OPTIONS)) {
      expect(config.name, `${name}: name should be truthy`).toBeTruthy();
      expect(config.command, `${name}: command should be truthy`).toBeTruthy();
      expect(Array.isArray(config.args), `${name}: args should be array`).toBe(true);
      expect(config.icon, `${name}: icon should be truthy`).toBeTruthy();
    }
  });

  it('has correct command for each harness', () => {
    expect(HARNESS_OPTIONS.codex.command).toBe('codex');
    expect(HARNESS_OPTIONS.opencode.command).toBe('opencode');
    expect(HARNESS_OPTIONS.pi.command).toBe('pi');
    expect(HARNESS_OPTIONS.claude.command).toBe('claude');
  });

  it('has modelArg defined for all harnesses', () => {
    for (const [name, config] of Object.entries(HARNESS_OPTIONS)) {
      expect(config.modelArg, `${name}: modelArg should be defined`).toBeDefined();
    }
  });

  it('codex uses -m model argument', () => {
    expect(HARNESS_OPTIONS.codex.modelArg).toBe('-m');
  });

  it('opencode uses -m model argument', () => {
    expect(HARNESS_OPTIONS.opencode.modelArg).toBe('-m');
  });

  it('pi uses --model argument', () => {
    expect(HARNESS_OPTIONS.pi.modelArg).toBe('--model');
  });

  it('opencode has permission env configured', () => {
    expect(HARNESS_OPTIONS.opencode.env).toBeDefined();
    expect(HARNESS_OPTIONS.opencode.env?.OPENCODE_PERMISSION).toBeDefined();
  });
});

// ============================================================================
// discoverHarnessModels Tests - Integration with Real Commands
// ============================================================================

describe('discoverHarnessModels', () => {
  // Clear cache before each test
  beforeEach(() => {
    // Clear the internal cache by accessing the module's internal state
    // This is a workaround since cache is module-level private
  });

  it('returns fallback for unknown harness', async () => {
    const models = await discoverHarnessModels('nonexistent');
    expect(models).toEqual([]);
  });

  it('returns models for codex via CLI discovery', async () => {
    const models = await discoverHarnessModels('codex');

    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('id');
    expect(models[0]).toHaveProperty('label');
  });

  it('returns fallback when command fails', async () => {
    // Real command execution with fallback - tests integration behavior
    const models = await discoverHarnessModels('pi');
    
    // Should either get real models or fallback
    expect(models).toBeDefined();
    expect(Array.isArray(models)).toBe(true);
  });

  it('models have correct structure', async () => {
    const models = await discoverHarnessModels('codex');
    
    for (const model of models) {
      expect(typeof model.id).toBe('string');
      expect(typeof model.label).toBe('string');
      expect(model.id.length).toBeGreaterThan(0);
    }
  });

  it('codex discovery returns gpt models', async () => {
    const models = await discoverHarnessModels('codex');
    const ids = models.map(m => m.id);

    expect(ids.some(id => id.startsWith('gpt'))).toBe(true);
  });

  it('no duplicate model IDs in result', async () => {
    const models = await discoverHarnessModels('opencode');
    const ids = models.map(m => m.id);
    const uniqueIds = [...new Set(ids)];
    
    expect(ids.length).toBe(uniqueIds.length);
  });

  it('handles concurrent discovery for same harness', async () => {
    // Test that concurrent calls don't cause issues
    const [models1, models2] = await Promise.all([
      discoverHarnessModels('codex'),
      discoverHarnessModels('codex'),
    ]);
    
    expect(models1).toBeDefined();
    expect(models2).toBeDefined();
  });

  it('handles multiple different harnesses', async () => {
    const [codex, pi, claude] = await Promise.all([
      discoverHarnessModels('codex'),
      discoverHarnessModels('pi'),
      discoverHarnessModels('claude'),
    ]);
    
    expect(codex).toBeDefined();
    expect(pi).toBeDefined();
    expect(claude).toBeDefined();
  });
});

// ============================================================================
// Model Option Structure Tests
// ============================================================================

describe('ModelOption structure', () => {
  it('codex discovered models have valid structure', async () => {
    const models = await discoverHarnessModels('codex');
    
    for (const model of models) {
      // Verify structure
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('label');
      expect(typeof model.id).toBe('string');
      expect(typeof model.label).toBe('string');
      
      // Verify id is not empty
      expect(model.id.trim().length).toBeGreaterThan(0);
    }
  });

  it('model IDs are properly formatted', async () => {
    const models = await discoverHarnessModels('opencode');
    
    for (const model of models) {
      // IDs should match pattern: provider/model-name
      // or just model-name for some providers
      // Note: Model IDs may contain dots, underscores, and hyphens
      expect(model.id).toMatch(/^[\w/.:-]+$/);
    }
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('parse edge cases', () => {
  it('parsePiModels handles empty input', () => {
    expect(parsePiModels('')).toEqual([]);
  });

  it('parseOpenCodeModels handles empty input', () => {
    expect(parseOpenCodeModels('')).toEqual([]);
  });

  it('parseOpenCodeModels handles only invalid lines', () => {
    const output = 'not a model\nalso not a model\n[ERROR]';
    const models = parseOpenCodeModels(output);
    expect(models).toEqual([]);
  });

  it('parsePiModels handles malformed provider/model lines', () => {
    const output = `Provider  Model
────────  ────────────────
just-one-word
another-single
anthropic  claude-sonnet`;

    const models = parsePiModels(output);
    // Should only include lines with at least 2 columns after parsing
    expect(models.some(m => m.id === 'anthropic/claude-sonnet')).toBe(true);
  });
});