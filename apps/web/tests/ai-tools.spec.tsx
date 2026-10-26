import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    defaults: { baseURL: 'http://api.test' },
  },
}));
vi.mock('../app/lib/api', () => ({ api }));

import { ToolsPanel } from '../app/dashboard/ai/_components/ToolsPanel';
import {
  isToolEndpointUrl,
  sampleToolArguments,
  toolErrorText,
  type AiAgentTool,
} from '../app/lib/ai';

const TOOL: AiAgentTool = {
  id: 'tool-1',
  agentId: 'agent-1',
  name: 'getCustomerName',
  description: 'Looks up a customer',
  parametersSchema: {
    type: 'object',
    properties: {
      customerId: { type: 'string' },
      tier: { type: 'string', enum: ['gold', 'silver'] },
      count: { type: 'integer' },
      vip: { type: 'boolean' },
    },
    required: ['customerId'],
  },
  endpointUrl: 'https://api.acme.com/tools/customer',
  method: 'POST',
  enabled: true,
  requiresConfirmation: false,
  timeoutMs: 8000,
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
} as AiAgentTool;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tool helpers', () => {
  it('builds sample arguments from the schema', () => {
    expect(sampleToolArguments(TOOL.parametersSchema)).toEqual({
      customerId: 'example',
      tier: 'gold',
      count: 1,
      vip: true,
    });
    expect(sampleToolArguments(null)).toEqual({});
  });

  it('accepts https and local http endpoints only', () => {
    expect(isToolEndpointUrl('https://api.acme.com/x')).toBe(true);
    expect(isToolEndpointUrl('http://localhost:4000/x')).toBe(true);
    expect(isToolEndpointUrl('http://api.acme.com/x')).toBe(false);
    expect(isToolEndpointUrl('http://localhost.evil.com/x')).toBe(false);
  });

  it('explains gateway error codes', () => {
    expect(toolErrorText('HTTP_502')).toBe('The endpoint answered with HTTP 502.');
    expect(toolErrorText('BLOCKED_ADDRESS')).toMatch(/private or reserved/);
    expect(toolErrorText(null)).toBe('');
  });
});

describe('ToolsPanel test call', () => {
  it('sends sample arguments and shows status, latency and the response', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        status: 'SUCCESS',
        latencyMs: 42,
        httpStatus: 200,
        errorCode: null,
        responsePreview: '{"name":"Sam"}',
      },
    });
    render(<ToolsPanel agentId="agent-1" tools={[TOOL]} onChange={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test getCustomerName' }));
    fireEvent.click(screen.getByRole('button', { name: /Send test call/ }));

    await waitFor(() => expect(screen.getByTestId('tool-test-result')).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('/ai/agents/agent-1/tools/tool-1/test', {
      arguments: { customerId: 'example', tier: 'gold', count: 1, vip: true },
    });
    expect(screen.getByText('Success')).toBeTruthy();
    expect(screen.getByText('42 ms')).toBeTruthy();
    expect(screen.getByText('HTTP 200')).toBeTruthy();
    expect(screen.getByText('{"name":"Sam"}')).toBeTruthy();
  });

  it('explains a failure', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        status: 'FAILED',
        latencyMs: 3,
        httpStatus: null,
        errorCode: 'BLOCKED_ADDRESS',
        responsePreview: null,
      },
    });
    render(<ToolsPanel agentId="agent-1" tools={[TOOL]} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test getCustomerName' }));
    fireEvent.click(screen.getByRole('button', { name: /Send test call/ }));

    await waitFor(() => expect(screen.getByText('Failed')).toBeTruthy());
    expect(screen.getByText(/private or reserved address/)).toBeTruthy();
  });

  it('refuses arguments that are not a JSON object', async () => {
    render(<ToolsPanel agentId="agent-1" tools={[TOOL]} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Test getCustomerName' }));
    fireEvent.change(screen.getByLabelText('Sample arguments (JSON)'), { target: { value: '[1]' } });
    fireEvent.click(screen.getByRole('button', { name: /Send test call/ }));

    expect(await screen.findByText('Arguments must be a JSON object.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
