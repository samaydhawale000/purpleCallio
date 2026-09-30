import type {
  PurpleCallioConfig,
  Call,
  CallDetails,
  CreateCallParams,
  CreateCallResult,
  JoinCallResult,
} from './types';

/**
 * Low-level REST client for the PurpleCallio API.
 * Server-side only — never expose an API key to the browser.
 */
export class PurpleCallioClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(config: PurpleCallioConfig) {
    if (!config.apiKey) throw new Error('PurpleCallio: apiKey is required');
    this.apiKey = config.apiKey;
    this.apiUrl = (config.apiUrl ?? config.baseUrl ?? 'https://api.purplecallio.com').replace(/\/$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(err.message ?? `PurpleCallio error ${res.status}: ${path}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Create a new call. Returns the spec response:
   * `{ callId, hostedUrl, participants: [{ participantId, token, hostedUrl, expiresAt }] }`
   */
  async createCall(params: CreateCallParams): Promise<CreateCallResult> {
    const data = await this.request<CreateCallResult>('POST', '/calls', {
      callerId: params.callerId,
      receiverId: params.receiverId,
      type: params.type ?? 'VIDEO',
    });

    return data;
  }

  /** Record a participant joining a call (session-token guarded). */
  async joinCall(callId: string, token: string): Promise<JoinCallResult> {
    return this.request<JoinCallResult>(
      'POST',
      `/calls/${callId}/join`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
  }

  /** Record a participant leaving a call. */
  async leaveCall(callId: string, token: string): Promise<{ callId: string; left: boolean }> {
    return this.request<{ callId: string; left: boolean }>(
      'POST',
      `/calls/${callId}/leave`,
      undefined,
      { Authorization: `Bearer ${token}` },
    );
  }

  /** Accept a pending call (typically called by your server on receiver's behalf). */
  async acceptCall(callId: string, token?: string): Promise<Call> {
    return this.request<Call>(
      'POST',
      `/calls/${callId}/accept`,
      undefined,
      token ? { Authorization: `Bearer ${token}` } : undefined,
    );
  }

  /** Reject a pending call. */
  async rejectCall(callId: string, token?: string): Promise<Call> {
    return this.request<Call>(
      'POST',
      `/calls/${callId}/reject`,
      undefined,
      token ? { Authorization: `Bearer ${token}` } : undefined,
    );
  }

  /** End an active call. */
  async endCall(callId: string, token?: string): Promise<Call> {
    return this.request<Call>(
      'POST',
      `/calls/${callId}/end`,
      undefined,
      token ? { Authorization: `Bearer ${token}` } : undefined,
    );
  }

  /** Fetch details for a specific call. */
  async getCall(callId: string): Promise<Call> {
    return this.request<Call>('GET', `/calls/${callId}`);
  }

  /** Fetch call details incl. branding + participant token (session-token guarded). */
  async getCallDetails(callId: string, token: string): Promise<CallDetails> {
    return this.request<CallDetails>('GET', `/calls/${callId}`, undefined, {
      Authorization: `Bearer ${token}`,
    });
  }

  /** List all calls for this project. */
  async getCalls(): Promise<Call[]> {
    return this.request<Call[]>('GET', '/calls');
  }
}
