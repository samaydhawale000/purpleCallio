import { ConflictException, NotFoundException } from '@nestjs/common';

import { AiAgentService } from './ai-agent.service';

const OWNER = 'user_a';
const STRANGER = 'user_b';
const PROJECT = 'project_a';
const OTHER_PROJECT = 'project_b';

/**
 * Minimal in-memory fake for the AI agent models, in the same hand-rolled
 * style as support.service.spec.ts. Supports just the query shapes
 * AiAgentService uses.
 */
function createFakePrisma() {
  let idCounter = 0;
  let clock = Date.now();
  const tick = () => new Date(++clock);
  const projects = [
    { id: PROJECT, ownerId: OWNER },
    { id: OTHER_PROJECT, ownerId: STRANGER },
  ];
  const agents: any[] = [];
  const versions: any[] = [];
  const tools: any[] = [];

  const matches = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'project') {
        const project = projects.find((p) => p.id === row.projectId);
        return !!project && matches(project, v);
      }
      return (row[k] ?? null) === v;
    });

  const sortBy = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    const sign = dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => (a[key] > b[key] ? sign : -sign));
  };

  const model = (rows: any[], defaults: () => object, unique?: string[]) => ({
    create: jest.fn(async ({ data }: any) => {
      if (unique && rows.some((r) => unique.every((k) => r[k] === data[k]))) {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      const now = tick();
      const clean = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      const row = {
        id: `id_${++idCounter}`,
        createdAt: now,
        updatedAt: now,
        ...defaults(),
        ...clean,
      };
      rows.push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const row = sortBy(
        rows.filter((r) => matches(r, where)),
        orderBy,
      )[0];
      return row ? { ...row } : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where, orderBy }: any) =>
      sortBy(
        rows.filter((r) => matches(r, where)),
        orderBy,
      ).map((r) => ({ ...r })),
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      const clean = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      if (
        unique &&
        rows.some(
          (r) =>
            r !== row && unique.every((k) => r[k] === { ...row, ...clean }[k]),
        )
      ) {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }
      Object.assign(row, clean, { updatedAt: tick() });
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const index = rows.findIndex((r) => r.id === where.id);
      return rows.splice(index, 1)[0];
    }),
  });

  const store: any = {
    project: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          projects.find((p) => matches(p, where)) ?? null,
      ),
    },
    aiAgent: model(agents, () => ({
      description: null,
      status: 'ACTIVE',
      currentVersionId: null,
      storeTranscript: false,
      transcriptRetentionDays: null,
      deletedAt: null,
    })),
    aiAgentVersion: model(
      versions,
      () => ({ provider: 'gemini', model: null, language: 'en' }),
      ['agentId', 'version'],
    ),
    aiAgentTool: model(
      tools,
      () => ({
        method: 'POST',
        enabled: true,
        requiresConfirmation: false,
        timeoutMs: 8000,
      }),
      ['agentId', 'name'],
    ),
  };
  // Callback form: the fake has no rollback, the tests don't rely on one.
  store.$transaction = jest.fn(async (fn: any) => fn(store));

  return { store, agents, versions, tools };
}

const TOOL = {
  name: 'lookup_order',
  description: 'Look up an order by id',
  parametersSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
  },
  endpointUrl: 'https://api.acme.com/tools/order',
};

describe('AiAgentService', () => {
  let fake: ReturnType<typeof createFakePrisma>;
  let service: AiAgentService;
  let paidPlan: boolean;

  const createAgent = (overrides: object = {}) =>
    service.createAgent(OWNER, {
      projectId: PROJECT,
      name: '  Support bot  ',
      instructions: 'Be helpful.',
      ...overrides,
    });

  beforeEach(() => {
    fake = createFakePrisma();
    paidPlan = true;
    const access = { hasPaidPlan: jest.fn(async () => paidPlan) };
    service = new AiAgentService(fake.store, access as never);
  });

  afterEach(() => {
    delete process.env.AI_MAX_DURATION_CAP_SECONDS;
    delete process.env.AI_DEFAULT_MAX_DURATION_SECONDS;
    delete process.env.AI_TOOL_TIMEOUT_MS;
  });

  describe('agents', () => {
    it('creates an agent with version 1 as its current version', async () => {
      const agent = await createAgent({ welcomeMessage: 'Hi!' });

      expect(agent.name).toBe('Support bot');
      expect(agent.status).toBe('ACTIVE');
      expect(agent.currentVersionId).toBe(agent.currentVersion.id);
      expect(agent.currentVersion).toMatchObject({
        version: 1,
        instructions: 'Be helpful.',
        welcomeMessage: 'Hi!',
        language: 'en',
        voice: null,
        provider: 'gemini',
        maxDurationSeconds: 600,
      });
      expect(agent).not.toHaveProperty('deletedAt');
    });

    it('clamps maxDurationSeconds to AI_MAX_DURATION_CAP_SECONDS', async () => {
      process.env.AI_MAX_DURATION_CAP_SECONDS = '900';
      const agent = await createAgent({ maxDurationSeconds: 5000 });
      expect(agent.currentVersion.maxDurationSeconds).toBe(900);
    });

    it('lists, gets and soft-deletes agents', async () => {
      const a = await createAgent({ name: 'A' });
      await createAgent({ name: 'B' });

      const list = await service.listAgents(OWNER, PROJECT);
      expect(list.map((x) => x.name)).toEqual(['B', 'A']);

      const detail = await service.getAgent(OWNER, a.id);
      expect(detail.currentVersion?.version).toBe(1);
      expect(detail.tools).toEqual([]);

      await expect(service.deleteAgent(OWNER, a.id)).resolves.toEqual({
        success: true,
      });
      expect(fake.agents.find((x) => x.id === a.id).deletedAt).toBeInstanceOf(
        Date,
      );
      expect(
        (await service.listAgents(OWNER, PROJECT)).map((x) => x.name),
      ).toEqual(['B']);
      await expect(service.getAgent(OWNER, a.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns 404 for another account's agent and project", async () => {
      const agent = await createAgent();

      await expect(service.getAgent(STRANGER, agent.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.updateAgent(STRANGER, agent.id, { name: 'pwned' }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.deleteAgent(STRANGER, agent.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.listVersions(STRANGER, agent.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.createTool(STRANGER, agent.id, TOOL),
      ).rejects.toThrow(NotFoundException);
      await expect(service.listAgents(STRANGER, PROJECT)).rejects.toThrow(
        NotFoundException,
      );
      await expect(createAgent({ projectId: OTHER_PROJECT })).rejects.toThrow(
        NotFoundException,
      );
      expect(fake.agents).toHaveLength(1);
    });

    it('edits name, status and transcript settings in place without a new version', async () => {
      const agent = await createAgent();

      const updated = await service.updateAgent(OWNER, agent.id, {
        name: 'Renamed',
        description: 'desc',
        status: 'DISABLED',
        storeTranscript: true,
        transcriptRetentionDays: 30,
      });

      expect(updated).toMatchObject({
        name: 'Renamed',
        description: 'desc',
        status: 'DISABLED',
        storeTranscript: true,
        transcriptRetentionDays: 30,
        currentVersionId: agent.currentVersionId,
      });
      expect(fake.versions).toHaveLength(1);
    });

    it('creates a new version on a config change and keeps the old one', async () => {
      const agent = await createAgent({ voice: 'Puck' });

      const updated = await service.updateAgent(OWNER, agent.id, {
        instructions: 'Be concise.',
        name: 'Renamed',
      });

      expect(updated.name).toBe('Renamed');
      expect(updated.currentVersionId).not.toBe(agent.currentVersionId);
      expect(updated.currentVersion).toMatchObject({
        version: 2,
        instructions: 'Be concise.',
        voice: 'Puck', // unchanged fields carry over
        maxDurationSeconds: 600,
      });

      const history = await service.listVersions(OWNER, agent.id);
      expect(history.map((v) => v.version)).toEqual([2, 1]);
      expect(history[1].instructions).toBe('Be helpful.');
    });

    it('does not create a version when config values are unchanged', async () => {
      const agent = await createAgent();

      await service.updateAgent(OWNER, agent.id, {
        instructions: 'Be helpful.',
        language: 'en',
      });

      expect(fake.versions).toHaveLength(1);
    });

    it('clears nullable config fields with null', async () => {
      const agent = await createAgent({ welcomeMessage: 'Hi', voice: 'Puck' });

      const updated = await service.updateAgent(OWNER, agent.id, {
        welcomeMessage: null,
        voice: null,
      });

      expect(updated.currentVersion).toMatchObject({
        version: 2,
        welcomeMessage: null,
        voice: null,
      });
    });

    it('switches provider in a new version, dropping the old voice and model', async () => {
      const agent = await createAgent({ voice: 'Puck' });
      fake.versions[0].model = 'gemini-3.8-live';

      const switched = await service.updateAgent(OWNER, agent.id, {
        provider: 'openai',
      });
      expect(switched.currentVersion).toMatchObject({
        version: 2,
        provider: 'openai',
        voice: null,
        model: null,
      });

      const withVoice = await service.updateAgent(OWNER, agent.id, {
        provider: 'gemini',
        voice: 'Kore',
      });
      expect(withVoice.currentVersion).toMatchObject({
        version: 3,
        provider: 'gemini',
        voice: 'Kore',
      });
    });

    it('maps a version-number race to 409', async () => {
      const agent = await createAgent();
      fake.store.aiAgentVersion.create.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );

      await expect(
        service.updateAgent(OWNER, agent.id, { instructions: 'New' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('paid plan', () => {
    const PAID_PLAN_REQUIRED = expect.objectContaining({
      response: expect.objectContaining({ code: 'AI_PAID_PLAN_REQUIRED' }),
    });

    it('blocks creating an agent on the Free plan', async () => {
      paidPlan = false;
      await expect(createAgent()).rejects.toEqual(PAID_PLAN_REQUIRED);
      expect(fake.agents).toHaveLength(0);
    });

    it('blocks re-enabling but allows list, view, edit, disable and delete on Free', async () => {
      const agent = await createAgent();
      paidPlan = false;

      await expect(service.listAgents(OWNER, PROJECT)).resolves.toHaveLength(1);
      await expect(service.getAgent(OWNER, agent.id)).resolves.toBeTruthy();
      await service.updateAgent(OWNER, agent.id, { name: 'Edited' });
      await service.updateAgent(OWNER, agent.id, { status: 'DISABLED' });
      await expect(
        service.updateAgent(OWNER, agent.id, { status: 'ACTIVE' }),
      ).rejects.toEqual(PAID_PLAN_REQUIRED);
      expect(fake.agents[0].status).toBe('DISABLED');
      await expect(service.deleteAgent(OWNER, agent.id)).resolves.toEqual({
        success: true,
      });
    });
  });

  describe('tools', () => {
    it('returns signingSecret only on create', async () => {
      const agent = await createAgent();

      const tool = await service.createTool(OWNER, agent.id, TOOL);
      expect(tool.signingSecret).toMatch(/^bj_tool_[0-9a-f]{64}$/);
      expect(tool).toMatchObject({
        name: 'lookup_order',
        method: 'POST',
        enabled: true,
        timeoutMs: 8000,
      });

      const [listed] = await service.listTools(OWNER, agent.id);
      expect(listed).not.toHaveProperty('signingSecret');
      const detail = await service.getAgent(OWNER, agent.id);
      expect(detail.tools[0]).not.toHaveProperty('signingSecret');
      const updated = await service.updateTool(OWNER, agent.id, tool.id, {
        enabled: false,
      });
      expect(updated.enabled).toBe(false);
      expect(updated).not.toHaveProperty('signingSecret');
    });

    it('rejects a duplicate tool name on the same agent with 409', async () => {
      const agent = await createAgent();
      const other = await createAgent();
      await service.createTool(OWNER, agent.id, TOOL);

      await expect(service.createTool(OWNER, agent.id, TOOL)).rejects.toThrow(
        ConflictException,
      );
      // Unique per agent only.
      await expect(
        service.createTool(OWNER, other.id, TOOL),
      ).resolves.toBeDefined();

      const second = await service.createTool(OWNER, agent.id, {
        ...TOOL,
        name: 'second',
      });
      await expect(
        service.updateTool(OWNER, agent.id, second.id, { name: TOOL.name }),
      ).rejects.toThrow(ConflictException);
    });

    it('clamps timeoutMs to AI_TOOL_TIMEOUT_MS', async () => {
      process.env.AI_TOOL_TIMEOUT_MS = '5000';
      const agent = await createAgent();
      const tool = await service.createTool(OWNER, agent.id, {
        ...TOOL,
        timeoutMs: 20_000,
      });
      expect(tool.timeoutMs).toBe(5000);
    });

    it('deletes a tool and 404s a tool from another agent', async () => {
      const agent = await createAgent();
      const other = await createAgent();
      const tool = await service.createTool(OWNER, agent.id, TOOL);

      await expect(
        service.deleteTool(OWNER, other.id, tool.id),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateTool(STRANGER, agent.id, tool.id, { enabled: false }),
      ).rejects.toThrow(NotFoundException);

      await service.deleteTool(OWNER, agent.id, tool.id);
      expect(await service.listTools(OWNER, agent.id)).toEqual([]);
    });
  });
});
