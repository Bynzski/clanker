import { describe, expect, it } from 'vitest';
import { describeAttentionIndicator } from '../../../src/renderer/lib/agentAttentionPresentation';
import { snapshot } from '../../_helpers/attentionSnapshots';

describe('observational suppression description uses the existing selector', () => {
  it('can intentionally suppress a stored active Running snapshot only through eligibility', () => {
    const running = snapshot('term-a', 'running', 3);
    expect(describeAttentionIndicator(running, undefined, undefined, false)).toEqual({ eligible: false, indicator: 'none', suppression: 'ineligible' });
    expect(running.runtime.status).toBe('running');
  });

  it('never labels an eligible Running snapshot as acknowledged, even with higher seen watermarks', () => {
    const running = snapshot('term-a', 'running', 3);
    expect(describeAttentionIndicator(running, { completion: 99, request: 99 }, undefined, true)).toEqual({ eligible: true, indicator: 'running', suppression: 'none' });
  });

  it('distinguishes suppression by acknowledgement from a selector with no displayable fact', () => {
    const completed = snapshot('term-a', 'completed', 3);
    expect(describeAttentionIndicator(completed, { completion: 3, request: 0 }, undefined, true)).toMatchObject({ indicator: 'none', suppression: 'acknowledged' });
    expect(describeAttentionIndicator(completed, { completion: 2, request: 0 }, undefined, true)).toMatchObject({ indicator: 'turn_complete', suppression: 'none' });
    const idle = snapshot('term-a', 'idle', 4);
    expect(describeAttentionIndicator(idle, { completion: 3, request: 0 }, undefined, true)).toMatchObject({ indicator: 'none', suppression: 'selector-none' });
    expect(describeAttentionIndicator(undefined, undefined, undefined, true)).toMatchObject({ indicator: 'none', suppression: 'no-snapshot' });
  });

  it('uses the existing Stop selector for an acknowledged provisional turn', () => {
    const stopped = snapshot('term-a', 'provisional', 3);
    expect(describeAttentionIndicator(stopped, { completion: 3, request: 0 }, undefined, true)).toMatchObject({ indicator: 'none', suppression: 'acknowledged' });
    expect(describeAttentionIndicator(stopped, { completion: 2, request: 0 }, undefined, true)).toMatchObject({ indicator: 'turn_complete', suppression: 'none' });
  });
});
