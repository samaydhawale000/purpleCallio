import { Logger } from '@nestjs/common';

import { AiStatusController } from '../ai-status.controller';
import { AiProviderRegistry } from './ai-provider.registry';
import { GeminiProvider } from './gemini/gemini.provider';
import { OpenAiProvider } from './openai/openai.provider';

const ENV_KEYS = [
  'AI_ENABLED',
  'AI_DEFAULT_PROVIDER',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
];

describe('AiProviderRegistry', () => {
  const saved: Record<string, string | undefined> = {};
  let registry: AiProviderRegistry;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    registry = new AiProviderRegistry(new GeminiProvider(), new OpenAiProvider());
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('resolves both providers by name, defaulting to AI_DEFAULT_PROVIDER', () => {
    expect(registry.resolve('openai')?.name).toBe('openai');
    expect(registry.resolve('GEMINI')?.name).toBe('gemini');
    expect(registry.resolve(null)?.name).toBe('gemini');
    process.env.AI_DEFAULT_PROVIDER = 'openai';
    expect(registry.resolve(null)?.name).toBe('openai');
    expect(registry.resolve('other')).toBeNull();
  });

  it('lists only the providers with a key', () => {
    expect(registry.configured()).toEqual([]);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(registry.configured()).toEqual(['openai']);
    process.env.GEMINI_API_KEY = 'g-test';
    expect(registry.configured()).toEqual(['gemini', 'openai']);
  });

  it('GET /ai/status returns the configured providers while enabled', async () => {
    const access = { hasPaidPlan: jest.fn().mockResolvedValue(true) };
    const controller = new AiStatusController(access as never, registry);
    process.env.OPENAI_API_KEY = 'sk-test';

    await expect(controller.status({})).resolves.toEqual({
      enabled: false,
      providers: [],
    });
    process.env.AI_ENABLED = 'true';
    await expect(
      controller.status({ user: { userId: 'user_a' } }),
    ).resolves.toEqual({ enabled: true, providers: ['openai'], paidPlan: true });
  });
});
