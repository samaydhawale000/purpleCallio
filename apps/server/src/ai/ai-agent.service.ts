import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiAgent, AiAgentTool, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { aiConfig } from './ai.config';
import { AiAccessService } from './ai-access.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { CreateToolDto, UpdateToolDto } from './dto/tool.dto';

/** Fields that live on the immutable AiAgentVersion; changing any creates a new version. */
const CONFIG_FIELDS = [
  'instructions',
  'welcomeMessage',
  'language',
  'voice',
  'provider',
  'maxDurationSeconds',
] as const;

/** Fields edited in place on the AiAgent row. */
const IN_PLACE_FIELDS = [
  'name',
  'description',
  'status',
  'storeTranscript',
  'transcriptRetentionDays',
] as const;

type AgentConfig = {
  instructions: string;
  welcomeMessage: string | null;
  language: string;
  voice: string | null;
  provider: string;
  maxDurationSeconds: number;
};

const DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30;

const AGENT_NOT_FOUND = {
  code: 'AI_AGENT_NOT_FOUND',
  message: 'Agent not found',
};

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    private prisma: PrismaService,
    private access: AiAccessService,
  ) {}

  // ── Agents ───────────────────────────────────────────
  async createAgent(userId: string, dto: CreateAgentDto) {
    await this.assertProjectOwner(userId, dto.projectId);
    await this.assertPaidPlan(userId);
    const config: AgentConfig = {
      instructions: dto.instructions.trim(),
      welcomeMessage: dto.welcomeMessage?.trim() || null,
      language: dto.language ?? 'en',
      voice: dto.voice ?? null,
      provider: dto.provider ?? 'gemini',
      maxDurationSeconds: this.clampDuration(dto.maxDurationSeconds),
    };

    const { agent, version } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.aiAgent.create({
        data: {
          projectId: dto.projectId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
        },
      });
      const v1 = await tx.aiAgentVersion.create({
        data: { agentId: created.id, version: 1, ...config },
      });
      const updated = await tx.aiAgent.update({
        where: { id: created.id },
        data: { currentVersionId: v1.id },
      });
      return { agent: updated, version: v1 };
    });

    this.logger.log(
      `event=ai_agent_created agentId=${agent.id} projectId=${agent.projectId}`,
    );
    return { ...this.toAgent(agent), currentVersion: version, tools: [] };
  }

  async listAgents(userId: string, projectId: string) {
    await this.assertProjectOwner(userId, projectId);
    const agents = await this.prisma.aiAgent.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return agents.map((a) => this.toAgent(a));
  }

  async getAgent(userId: string, agentId: string) {
    const agent = await this.findOwnedAgent(userId, agentId);
    const [currentVersion, tools] = await Promise.all([
      agent.currentVersionId
        ? this.prisma.aiAgentVersion.findUnique({
            where: { id: agent.currentVersionId },
          })
        : null,
      this.prisma.aiAgentTool.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ...this.toAgent(agent),
      currentVersion,
      tools: tools.map((t) => this.toTool(t)),
    };
  }

  /**
   * Config fields that actually differ from the current version create a new
   * version and move currentVersionId; the rest are edited in place.
   */
  async updateAgent(userId: string, agentId: string, dto: UpdateAgentDto) {
    const agent = await this.findOwnedAgent(userId, agentId);
    // Disabling, editing and deleting stay open on Free; re-enabling doesn't.
    if (dto.status === 'ACTIVE' && agent.status !== 'ACTIVE') {
      await this.assertPaidPlan(userId);
    }

    const inPlace: Prisma.AiAgentUpdateInput = {};
    for (const field of IN_PLACE_FIELDS) {
      if (dto[field] !== undefined) (inPlace as any)[field] = dto[field];
    }
    if (typeof inPlace.name === 'string') inPlace.name = inPlace.name.trim();
    if (typeof inPlace.description === 'string') {
      inPlace.description = inPlace.description.trim() || null;
    }
    // Storing needs a retention period; default one rather than storing nothing.
    const retention =
      dto.transcriptRetentionDays !== undefined
        ? dto.transcriptRetentionDays
        : agent.transcriptRetentionDays;
    if (dto.storeTranscript === true && retention == null) {
      inPlace.transcriptRetentionDays = DEFAULT_TRANSCRIPT_RETENTION_DAYS;
    }

    const configTouched = CONFIG_FIELDS.some((f) => dto[f] !== undefined);
    let newVersion: number | null = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (configTouched) {
          const current = agent.currentVersionId
            ? await tx.aiAgentVersion.findUnique({
                where: { id: agent.currentVersionId },
              })
            : null;
          const next = this.mergeConfig(current, dto);
          if (!current || this.configDiffers(current, next)) {
            const latest = await tx.aiAgentVersion.findFirst({
              where: { agentId: agent.id },
              orderBy: { version: 'desc' },
            });
            const created = await tx.aiAgentVersion.create({
              data: {
                agentId: agent.id,
                version: (latest?.version ?? 0) + 1,
                ...next,
                // A model pin belongs to its provider.
                model:
                  current?.provider === next.provider
                    ? (current?.model ?? null)
                    : null,
              },
            });
            inPlace.currentVersionId = created.id;
            newVersion = created.version;
          }
        }
        if (Object.keys(inPlace).length > 0) {
          await tx.aiAgent.update({ where: { id: agent.id }, data: inPlace });
        }
      });
    } catch (e: any) {
      // Two concurrent config edits raced for the same version number.
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'The agent was changed at the same time. Please retry.',
        );
      }
      throw e;
    }

    if (newVersion !== null) {
      this.logger.log(
        `event=ai_agent_version_created agentId=${agent.id} version=${newVersion}`,
      );
    }
    return this.getAgent(userId, agent.id);
  }

  async deleteAgent(userId: string, agentId: string) {
    const agent = await this.findOwnedAgent(userId, agentId);
    await this.prisma.aiAgent.update({
      where: { id: agent.id },
      data: { deletedAt: new Date() },
    });
    this.logger.log(`event=ai_agent_deleted agentId=${agent.id}`);
    return { success: true };
  }

  async listVersions(userId: string, agentId: string) {
    const agent = await this.findOwnedAgent(userId, agentId);
    return this.prisma.aiAgentVersion.findMany({
      where: { agentId: agent.id },
      orderBy: { version: 'desc' },
    });
  }

  // ── Tools ────────────────────────────────────────────
  /** The only response that includes signingSecret. */
  async createTool(userId: string, agentId: string, dto: CreateToolDto) {
    const agent = await this.findOwnedAgent(userId, agentId);
    try {
      const tool = await this.prisma.aiAgentTool.create({
        data: {
          agentId: agent.id,
          name: dto.name,
          description: dto.description.trim(),
          parametersSchema: dto.parametersSchema as Prisma.InputJsonValue,
          endpointUrl: dto.endpointUrl,
          method: dto.method,
          enabled: dto.enabled,
          requiresConfirmation: dto.requiresConfirmation,
          timeoutMs: this.clampToolTimeout(dto.timeoutMs),
          signingSecret: `bj_tool_${randomBytes(32).toString('hex')}`,
        },
      });
      this.logger.log(
        `event=ai_tool_created agentId=${agent.id} toolId=${tool.id}`,
      );
      return { ...this.toTool(tool), signingSecret: tool.signingSecret };
    } catch (e: any) {
      if (e?.code === 'P2002') throw this.duplicateToolName();
      throw e;
    }
  }

  async listTools(userId: string, agentId: string) {
    const agent = await this.findOwnedAgent(userId, agentId);
    const tools = await this.prisma.aiAgentTool.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'asc' },
    });
    return tools.map((t) => this.toTool(t));
  }

  async updateTool(
    userId: string,
    agentId: string,
    toolId: string,
    dto: UpdateToolDto,
  ) {
    const tool = await this.findOwnedTool(userId, agentId, toolId);
    try {
      const updated = await this.prisma.aiAgentTool.update({
        where: { id: tool.id },
        data: {
          name: dto.name,
          description: dto.description?.trim(),
          parametersSchema: dto.parametersSchema as
            | Prisma.InputJsonValue
            | undefined,
          endpointUrl: dto.endpointUrl,
          method: dto.method,
          enabled: dto.enabled,
          requiresConfirmation: dto.requiresConfirmation,
          timeoutMs:
            dto.timeoutMs === undefined
              ? undefined
              : this.clampToolTimeout(dto.timeoutMs),
        },
      });
      return this.toTool(updated);
    } catch (e: any) {
      if (e?.code === 'P2002') throw this.duplicateToolName();
      throw e;
    }
  }

  async deleteTool(userId: string, agentId: string, toolId: string) {
    const tool = await this.findOwnedTool(userId, agentId, toolId);
    await this.prisma.aiAgentTool.delete({ where: { id: tool.id } });
    this.logger.log(
      `event=ai_tool_deleted agentId=${agentId} toolId=${tool.id}`,
    );
    return { success: true };
  }

  // ── Helpers ──────────────────────────────────────────
  // Ownership is checked through project.ownerId. A missing, deleted or
  // foreign resource is indistinguishable (404), so ids can't be probed.
  private async assertProjectOwner(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  private async assertPaidPlan(userId: string) {
    if (!(await this.access.hasPaidPlan(userId))) {
      throw new ForbiddenException({
        code: 'AI_PAID_PLAN_REQUIRED',
        message:
          'AI voice agents unlock after your first verified credit purchase. Add credits in Billing.',
      });
    }
  }

  private async findOwnedAgent(userId: string, agentId: string) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id: agentId, deletedAt: null, project: { ownerId: userId } },
    });
    if (!agent) throw new NotFoundException(AGENT_NOT_FOUND);
    return agent;
  }

  private async findOwnedTool(userId: string, agentId: string, toolId: string) {
    const agent = await this.findOwnedAgent(userId, agentId);
    const tool = await this.prisma.aiAgentTool.findFirst({
      where: { id: toolId, agentId: agent.id },
    });
    if (!tool) throw new NotFoundException('Tool not found');
    return tool;
  }

  private mergeConfig(
    current: AgentConfig | null,
    dto: UpdateAgentDto,
  ): AgentConfig {
    const provider = dto.provider ?? current?.provider ?? 'gemini';
    // Voices are provider-specific: switching provider drops the old voice
    // unless the same patch picks a new one.
    const providerChanged = current !== null && provider !== current.provider;
    return {
      instructions: dto.instructions?.trim() ?? current?.instructions ?? '',
      welcomeMessage:
        dto.welcomeMessage !== undefined
          ? dto.welcomeMessage?.trim() || null
          : (current?.welcomeMessage ?? null),
      language: dto.language ?? current?.language ?? 'en',
      voice:
        dto.voice !== undefined
          ? dto.voice
          : providerChanged
            ? null
            : (current?.voice ?? null),
      provider,
      maxDurationSeconds: this.clampDuration(
        dto.maxDurationSeconds ?? current?.maxDurationSeconds,
      ),
    };
  }

  private configDiffers(current: AgentConfig, next: AgentConfig) {
    return CONFIG_FIELDS.some((f) => current[f] !== next[f]);
  }

  private clampDuration(seconds?: number) {
    const config = aiConfig();
    return Math.min(
      seconds ?? config.defaultMaxDurationSeconds,
      config.maxDurationCapSeconds,
    );
  }

  private clampToolTimeout(ms?: number) {
    const cap = aiConfig().toolTimeoutMs;
    return Math.min(ms ?? cap, cap);
  }

  private duplicateToolName() {
    return new ConflictException('A tool with this name already exists.');
  }

  private toAgent(agent: AiAgent) {
    const { deletedAt: _deletedAt, ...rest } = agent;
    return rest;
  }

  /** signingSecret is never returned after creation. */
  private toTool(tool: AiAgentTool) {
    const { signingSecret: _secret, ...rest } = tool;
    return rest;
  }
}
