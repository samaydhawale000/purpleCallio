import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { NotificationType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
  ) {}

  async createProject(
  ownerId: string,
  data: {
    name: string;
    description?: string;
  },
) {
  const project = await this.prisma.project.create({
    data: {
      name: data.name,
      description: data.description,
      ownerId,
    },
  });
  await this.notifications.createNotification({
    userId: ownerId,
    type: NotificationType.PROJECT_CREATED,
    title: 'Project created',
    message: `Your new project "${project.name}" has been created successfully.`,
    metadata: { projectId: project.id },
  });
  return project;
}
  async getProjects(ownerId: string) {
    return this.prisma.project.findMany({
      where: {
        ownerId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateWebhook(projectId: string, ownerId: string, webhookUrl: string | null) {
    const secret = webhookUrl ? randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '') : null;
    return this.prisma.project.update({
      where: { id: projectId, ownerId },
      data: { webhookUrl, webhookSecret: secret },
      select: { id: true, webhookUrl: true, webhookSecret: true },
    });
  }
}