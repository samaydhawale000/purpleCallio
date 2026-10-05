import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyService } from './api-key.service';

describe('ApiKeyService project ownership', () => {
  const prisma = {
    project: { findFirst: jest.fn() },
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const service = new ApiKeyService(prisma as unknown as PrismaService, { createNotification: jest.fn(), notifyAdmins: jest.fn() } as never);

  beforeEach(() => jest.clearAllMocks());

  it('creates a key only after confirming the project belongs to the user', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-1' });
    prisma.apiKey.create.mockResolvedValue({ id: 'key-1' });

    await service.createApiKey('user-1', 'project-1', 'server');

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-1', ownerId: 'user-1' },
    });
    expect(prisma.apiKey.create).toHaveBeenCalledTimes(1);
  });

  it('does not create a key for another user’s project', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.createApiKey('user-1', 'project-2', 'server'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.apiKey.create).not.toHaveBeenCalled();
  });

  it('does not list another user’s project keys', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.getProjectKeys('user-1', 'project-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.apiKey.findMany).not.toHaveBeenCalled();
  });
});
