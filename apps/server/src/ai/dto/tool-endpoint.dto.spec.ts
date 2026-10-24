import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateToolDto, TestToolDto } from './tool.dto';

async function errorsFor(cls: any, body: object) {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

const TOOL = {
  name: 'getCustomerName',
  description: 'Look up a customer',
  parametersSchema: { type: 'object', properties: {} },
};

describe('tool endpoint URL and test DTO', () => {
  const saved = process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;

  afterEach(() => {
    if (saved === undefined)
      delete process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
    else process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST = saved;
  });

  const LOCAL = [
    'http://localhost:4000/tools/customer',
    'https://localhost:8443/tools',
    'http://127.0.0.1:4000',
    'http://[::1]:4000/x',
  ];

  it('refuses localhost URLs by default', async () => {
    delete process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST;
    for (const endpointUrl of LOCAL) {
      expect(await errorsFor(CreateToolDto, { ...TOOL, endpointUrl })).toEqual([
        'endpointUrl',
      ]);
    }
  });

  it('accepts localhost URLs with AI_TOOLS_ALLOW_INSECURE_LOCALHOST', async () => {
    process.env.AI_TOOLS_ALLOW_INSECURE_LOCALHOST = 'true';
    for (const endpointUrl of LOCAL) {
      expect(await errorsFor(CreateToolDto, { ...TOOL, endpointUrl })).toEqual(
        [],
      );
    }
    for (const endpointUrl of [
      'http://api.acme.com/x',
      'http://localhost.evil.com/x',
      'http://10.0.0.1/x',
    ]) {
      expect(await errorsFor(CreateToolDto, { ...TOOL, endpointUrl })).toEqual([
        'endpointUrl',
      ]);
    }
  });

  it('takes an optional arguments object for a test call', async () => {
    expect(await errorsFor(TestToolDto, {})).toEqual([]);
    expect(await errorsFor(TestToolDto, { arguments: { id: 'c_1' } })).toEqual(
      [],
    );
    expect(await errorsFor(TestToolDto, { arguments: 'nope' })).toEqual([
      'arguments',
    ]);
  });
});
