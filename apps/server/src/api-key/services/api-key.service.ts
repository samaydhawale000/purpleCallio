import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';

import { randomBytes, createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';

// Fields safe to return from listing endpoints — never the hash, and never
// the raw key (which only ever exists in the createApiKey() response, once).
const MASKED_SELECT = {
  id: true,
  keyPrefix: true,
  name: true,
  isActive: true,
  createdAt: true,
} as const;

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

@Injectable()
export class ApiKeyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Creates a key and returns the raw value exactly once — callers must
   * show it to the user immediately ("you won't be able to view this key
   * again") since only its hash is persisted from here on.
   */
  async createApiKey(userId: string, projectId: string, name: string) {
    await this.assertOwnership(userId, projectId);
    const rawKey = 'bj_live_' + randomBytes(32).toString('hex');

    const created = await this.prisma.apiKey.create({
      data: {
        keyHash: hashKey(rawKey),
        keyPrefix: rawKey.slice(0, 12),
        name,
        projectId,
      },
      select: MASKED_SELECT,
    });

    return { ...created, key: rawKey };
  }

  async getProjectKeys(userId: string, projectId: string) {
    await this.assertOwnership(userId, projectId);
    return this.prisma.apiKey.findMany({
      where: {
        projectId,
      },
      select: MASKED_SELECT,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * List all API keys across all projects owned by the user.
   */
  async getAllKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: {
        project: {
          ownerId: userId,
        },
      },
      select: {
        ...MASKED_SELECT,
        project: {
          select: { id: true, name: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Update a key's active state or name. Only the owner of the
   * parent project may mutate it.
   */
  async updateKey(
    userId: string,
    keyId: string,
    data: { isActive?: boolean; name?: string },
  ) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: keyId, project: { ownerId: userId } },
    });
    if (!existing) throw new NotFoundException('API key not found');

    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        ...(typeof data.isActive === 'boolean'
          ? { isActive: data.isActive }
          : {}),
        ...(typeof data.name === 'string' ? { name: data.name } : {}),
      },
      select: MASKED_SELECT,
    });
  }

  /**
   * Revoke (delete) a key. Only the owner of the parent project may do so.
   */
  async revokeKey(userId: string, keyId: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id: keyId, project: { ownerId: userId } },
    });
    if (!existing) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.delete({ where: { id: keyId } });
    return { success: true };
  }

  /**
   * Verify a key belongs to a project the user owns (used to guard
   * project-level operations where needed).
   */
  async assertOwnership(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ownerId: userId },
    });
    if (!project) throw new ForbiddenException('Not your project');
    return project;
  }
}
