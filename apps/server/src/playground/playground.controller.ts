import { Controller, Post, UseGuards, Req, Body } from '@nestjs/common';

import { JwtGuard } from '../auth/guards/jwt.guard';

import { PlaygroundService } from './playground.service';

interface PlaygroundRequest {
  user: { userId: string };
  ip?: string;
  socket?: { remoteAddress?: string };
}

@Controller('playground')
@UseGuards(JwtGuard)
export class PlaygroundController {
  constructor(private readonly playgroundService: PlaygroundService) {}

  @Post('create')
  async createDemo(
    @Req() req: PlaygroundRequest,
    @Body() body: { type?: 'AUDIO' | 'VIDEO' },
  ) {
    return this.playgroundService.createDemoCall(
      req.user,
      body?.type ?? 'VIDEO',
      req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    );
  }
}
