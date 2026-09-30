import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { BillingGuard } from '../../common/guards/billing.guard';
import { CallSessionGuard } from '../../common/guards/call-session.guard';
import { CallService } from '../services/call.service';
import { CreateCallDto } from '../dto/create-call.dto';
import { WebrtcTransportDto } from '../dto/webrtc-transport.dto';
import { WebrtcIceDto } from '../dto/webrtc-ice.dto';

interface ApiKeyRequest {
  project: { id: string };
}

interface CallSessionRequest {
  callSession: {
    callId: string;
    role?: 'CALLER' | 'RECEIVER';
    [key: string]: unknown;
  };
}

@Controller('calls')
export class CallController {
  constructor(private callService: CallService) {}

  // Prevents an abused/leaked API key from mass-creating call sessions.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  @UseGuards(ApiKeyGuard, BillingGuard)
  create(@Req() req: ApiKeyRequest, @Body() body: CreateCallDto) {
    return this.callService.createCall({
      ...body,
      projectId: req.project.id,
    });
  }

  @Post(':id/accept')
  @UseGuards(CallSessionGuard)
  accept(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.acceptCall(id, req.callSession);
  }

  @Post(':id/reject')
  @UseGuards(CallSessionGuard)
  reject(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.rejectCall(id, req.callSession);
  }

  // Distinct from /reject: the CALLER ending a still-ringing call, vs the
  // RECEIVER declining it.
  @Post(':id/cancel')
  @UseGuards(CallSessionGuard)
  cancel(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.cancelCall(id, req.callSession);
  }

  @Post(':id/join')
  @UseGuards(CallSessionGuard)
  join(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.joinCall(id, req.callSession);
  }

  @Post(':id/leave')
  @UseGuards(CallSessionGuard)
  leave(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.leaveCall(id, req.callSession);
  }

  @Post(':id/end')
  @UseGuards(CallSessionGuard)
  end(@Param('id') id: string) {
    return this.callService.endCall(id);
  }

  // Client-reported WebRTC transport classification (P2P vs TURN-relayed),
  // straight from the browser's own getStats() — see CallService's doc
  // comment. Best-effort by design: never let a reporting failure surface
  // to the caller, since it isn't part of the actual call.
  @Post(':id/webrtc-transport')
  @UseGuards(CallSessionGuard)
  reportWebrtcTransport(
    @Req() req: CallSessionRequest,
    @Param('id') id: string,
    @Body() body: WebrtcTransportDto,
  ) {
    return this.callService.recordWebrtcTransport(
      id,
      req.callSession,
      body.transport,
      body.candidateType,
    );
  }

  // Client-reported ICE outcome — see CallService's doc comment on why a
  // call can report both a FAILED and a later SUCCESS. Best-effort, same as
  // webrtc-transport: never let a reporting failure surface to the caller.
  @Post(':id/webrtc-ice')
  @UseGuards(CallSessionGuard)
  reportWebrtcIce(
    @Req() req: CallSessionRequest,
    @Param('id') id: string,
    @Body() body: WebrtcIceDto,
  ) {
    return this.callService.recordWebrtcIceOutcome(
      id,
      req.callSession,
      body.outcome,
      body.iceConnectionState,
      body.connectionState,
    );
  }

  @Get(':id/details')
  @UseGuards(CallSessionGuard)
  getDetails(@Req() req: CallSessionRequest, @Param('id') id: string) {
    return this.callService.getCallDetails(id, req.callSession);
  }

  @Get(':id')
  @UseGuards(ApiKeyGuard)
  getCall(@Req() req: ApiKeyRequest, @Param('id') id: string) {
    return this.callService.getCall(id, req.project.id);
  }

  @Get()
  @UseGuards(ApiKeyGuard)
  getCalls(@Req() req: ApiKeyRequest) {
    return this.callService.getCalls(req.project.id);
  }
}
