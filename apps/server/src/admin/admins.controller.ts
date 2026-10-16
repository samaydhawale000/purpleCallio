import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { cleanPermissions, resolvePermissions } from './admin-access';
import { AdminGuard } from './guards/admin.guard';

const ADMIN_SELECT = { id: true, email: true, name: true, avatarUrl: true, adminPermissions: true } as const;

/**
 * Admin team management. `GET /admin/me` is open to any admin; everything
 * under /admin/admins is gated by the "admins" tab (see AdminGuard).
 */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@Req() req: any) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.user.userId }, select: ADMIN_SELECT });
    return { ...user, fullAccess: user.adminPermissions == null, permissions: resolvePermissions(user.adminPermissions) };
  }

  @Get('admins')
  async list() {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: ADMIN_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return admins.map((a) => ({ ...a, fullAccess: a.adminPermissions == null }));
  }

  /** Adds an admin by email. If they haven't signed up yet, their account is created and linked on first Google sign-in. */
  @Post('admins')
  async add(@Body() body: { email?: string; permissions?: unknown }) {
    const email = body.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid email is required');
    const adminPermissions = cleanPermissions(body.permissions);
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    if (existing?.role === 'ADMIN') throw new BadRequestException('This person is already an admin');
    return existing
      ? this.prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', adminPermissions }, select: ADMIN_SELECT })
      : this.prisma.user.create({ data: { email, role: 'ADMIN', adminPermissions }, select: ADMIN_SELECT });
  }

  @Patch('admins/:id')
  async update(@Param('id') id: string, @Req() req: any, @Body() body: { permissions?: unknown }) {
    await this.findAdmin(id, req.user.userId);
    return this.prisma.user.update({
      where: { id },
      data: { adminPermissions: cleanPermissions(body.permissions) },
      select: ADMIN_SELECT,
    });
  }

  /** Removes admin access; the account stays as a normal customer. */
  @Delete('admins/:id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.findAdmin(id, req.user.userId);
    await this.prisma.user.update({ where: { id }, data: { role: 'USER', adminPermissions: Prisma.DbNull } });
    return { ok: true };
  }

  private async findAdmin(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException("You can't change your own access");
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.role !== 'ADMIN') throw new NotFoundException('Admin not found');
    return user;
  }
}
