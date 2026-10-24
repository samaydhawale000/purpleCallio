import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateAgentDto } from './create-agent.dto';
import { UpdateAgentDto } from './update-agent.dto';
import { CreateToolDto, UpdateToolDto } from './tool.dto';

async function errorsFor(cls: any, body: object) {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

const PROJECT_ID = '3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c';
const TOOL = {
  name: 'lookup_order',
  description: 'Look up an order',
  parametersSchema: { type: 'object', properties: {} },
  endpointUrl: 'https://api.acme.com/tools/order',
};

describe('AI DTOs', () => {
  describe('agents', () => {
    it('accepts a valid agent', async () => {
      expect(
        await errorsFor(CreateAgentDto, {
          projectId: PROJECT_ID,
          name: 'Support bot',
          instructions: 'Be helpful.',
          language: 'en-US',
          voice: 'Puck',
          maxDurationSeconds: 300,
        }),
      ).toEqual([]);
    });

    it('requires name and instructions on create', async () => {
      expect(
        await errorsFor(CreateAgentDto, {
          projectId: PROJECT_ID,
          name: ' ',
        }),
      ).toEqual(['name', 'instructions']);
    });

    it('rejects bad language, duration and retention', async () => {
      expect(
        await errorsFor(UpdateAgentDto, {
          language: 'english',
          maxDurationSeconds: 5,
          transcriptRetentionDays: 14,
        }).then((props) => props.sort()),
      ).toEqual(['language', 'maxDurationSeconds', 'transcriptRetentionDays']);
    });

    it('allows null to clear nullable fields', async () => {
      expect(
        await errorsFor(UpdateAgentDto, {
          welcomeMessage: null,
          voice: null,
          description: null,
          transcriptRetentionDays: null,
        }),
      ).toEqual([]);
    });
  });

  describe('tools', () => {
    it('accepts a valid tool', async () => {
      expect(
        await errorsFor(CreateToolDto, { ...TOOL, method: 'GET' }),
      ).toEqual([]);
    });

    it.each(['lookup_order', 'a', 'getWeather2', 'x'.repeat(64)])(
      'accepts tool name %s',
      async (name) => {
        expect(await errorsFor(CreateToolDto, { ...TOOL, name })).toEqual([]);
      },
    );

    it.each(['', '1abc', '_private', 'has-dash', 'has space', 'x'.repeat(65)])(
      'rejects tool name %p',
      async (name) => {
        expect(await errorsFor(CreateToolDto, { ...TOOL, name })).toEqual([
          'name',
        ]);
        expect(await errorsFor(UpdateToolDto, { name })).toEqual(['name']);
      },
    );

    it('requires an https endpoint', async () => {
      for (const endpointUrl of [
        'http://api.acme.com/hook',
        'ftp://api.acme.com/hook',
        'api.acme.com/hook',
        'javascript:alert(1)',
      ]) {
        expect(
          await errorsFor(CreateToolDto, { ...TOOL, endpointUrl }),
        ).toEqual(['endpointUrl']);
      }
    });

    it('rejects schemas outside the supported subset', async () => {
      expect(
        await errorsFor(CreateToolDto, {
          ...TOOL,
          parametersSchema: {
            type: 'object',
            properties: { a: { type: 'array' } },
          },
        }),
      ).toEqual(['parametersSchema']);
      expect(
        await errorsFor(UpdateToolDto, {
          parametersSchema: { type: 'string' },
        }),
      ).toEqual(['parametersSchema']);
    });

    it('rejects an unknown method and an out-of-range timeout', async () => {
      expect(
        await errorsFor(CreateToolDto, {
          ...TOOL,
          method: 'DELETE',
          timeoutMs: 60_000,
        }),
      ).toEqual(['method', 'timeoutMs']);
    });
  });
});
