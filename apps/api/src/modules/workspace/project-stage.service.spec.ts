import { describe, expect, it } from 'vitest';
import { deriveProjectStage } from './project-stage.service.js';

const empty = {
  hasBastAttachment: false,
  hasImplementationStart: false,
  hasDevelopmentStart: false,
  bpmFinal: false,
  bpmStarted: false,
};

describe('deriveProjectStage', () => {
  it.each([
    [{}, 'PREPARE'],
    [{ bpmStarted: true }, 'DEFINE'],
    [{ bpmFinal: true }, 'DESIGN'],
    [{ hasDevelopmentStart: true }, 'DEVELOP'],
    [{ hasImplementationStart: true }, 'DEPLOY'],
    [{ hasBastAttachment: true }, 'COMPLETE'],
  ] as const)('derives the milestone from %o', (signals, expected) => {
    expect(deriveProjectStage({ ...empty, ...signals })).toBe(expected);
  });

  it('keeps the latest reached milestone when earlier signals also exist', () => {
    expect(
      deriveProjectStage({
        hasBastAttachment: true,
        hasImplementationStart: true,
        hasDevelopmentStart: true,
        bpmFinal: true,
        bpmStarted: true,
      }),
    ).toBe('COMPLETE');
  });
});
