import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CallSessionGuard } from '../common/guards/call-session.guard';
import { TurnService } from './turn.service';

interface TurnRequest {
  callSession?: {
    callId: string;
    call: { source: string; expiresAt: Date };
  };
  ip?: string;
  socket?: { remoteAddress?: string };
}

@Controller('turn')
export class TurnController {
  constructor(private turnService: TurnService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('credentials')
  @UseGuards(CallSessionGuard)
  getCredentials(@Req() req: TurnRequest) {
    if (req.callSession?.call?.source === 'PLAYGROUND') {
      return this.turnService.getPlaygroundCredentials(
        req.callSession.callId,
        req.ip ?? req.socket?.remoteAddress ?? 'unknown',
        req.callSession.call.expiresAt,
      );
    }
    return this.turnService.getCredentials();
  }
}
