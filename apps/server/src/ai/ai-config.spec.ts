import { ForbiddenException } from '@nestjs/common';

import { aiConfig } from './ai.config';
import { AiEnabledGuard } from './guards/ai-enabled.guard';
import { AiStatusController } from './ai-status.controller';

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_MAX_DURATION_CAP_SECONDS',
  'AI_DEFAULT_MAX_DURATION_SECONDS',
  'AI_TOOL_TIMEOUT_MS',
];

describe('AI feature flag and config', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('is disabled by default and uses the documented limits', () => {
    expect(aiConfig()).toEqual({
      enabled: false,
      maxConcurrentSessionsPerAccount: 3,
      globalMaxConcurrentSessions: 50,
      dailyMinutesPerAccount: 120,
      monthlyMinutesPerAccount: 1000,
      maxDurationCapSeconds: 1800,
      defaultMaxDurationSeconds: 600,
      sessionTtlSeconds: 300,
      maxToolCallsPerSession: 20,
      toolTimeoutMs: 8000,
      toolMaxResponseBytes: 65536,
      maxTranscriptMessages: 500,
    });
  });

  it('reads overrides and ignores invalid values', () => {
    process.env.AI_ENABLED = 'TRUE';
    process.env.AI_TOOL_TIMEOUT_MS = 'abc';
    process.env.AI_MAX_DURATION_CAP_SECONDS = '300';
    process.env.AI_DEFAULT_MAX_DURATION_SECONDS = '900';

    const config = aiConfig();
    expect(config.enabled).toBe(true);
    expect(config.toolTimeoutMs).toBe(8000);
    // The default never exceeds the cap.
    expect(config.defaultMaxDurationSeconds).toBe(300);
  });

  it('AiEnabledGuard returns 403 AI_DISABLED while the flag is off', () => {
    const guard = new AiEnabledGuard();
    let error: unknown;
    try {
      guard.canActivate();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'AI_DISABLED',
      message: 'AI Voice Agents are not enabled.',
    });

    process.env.AI_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('GET /ai/status reports the flag, and paidPlan only when signed in', async () => {
    const access = { hasPaidPlan: jest.fn().mockResolvedValue(true) };
    const controller = new AiStatusController(access as never);
    await expect(controller.status({ user: null })).resolves.toEqual({
      enabled: false,
    });
    process.env.AI_ENABLED = 'true';
    await expect(controller.status({})).resolves.toEqual({ enabled: true });
    expect(access.hasPaidPlan).not.toHaveBeenCalled();

    await expect(
      controller.status({ user: { userId: 'user_a' } }),
    ).resolves.toEqual({ enabled: true, paidPlan: true });
    access.hasPaidPlan.mockResolvedValue(false);
    await expect(
      controller.status({ user: { userId: 'user_a' } }),
    ).resolves.toEqual({ enabled: true, paidPlan: false });
  });
});
