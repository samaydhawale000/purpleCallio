import { describe, expect, it } from 'vitest';

import { PurpleCallioClient } from '../src/client';

describe('PurpleCallioClient configuration', () => {
  it('requires an API base URL instead of defaulting to a host that does not exist', () => {
    expect(() => new PurpleCallioClient({ apiKey: 'k' })).toThrow(/apiUrl is required/);
  });

  it('accepts apiUrl and the backwards-compatible baseUrl alias', () => {
    expect(() => new PurpleCallioClient({ apiKey: 'k', apiUrl: 'https://host.example/api' })).not.toThrow();
    expect(() => new PurpleCallioClient({ apiKey: 'k', baseUrl: 'https://host.example/api' })).not.toThrow();
  });
});
