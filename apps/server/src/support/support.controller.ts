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

import { JwtGuard } from '../auth/guards/jwt.guard';
import { SupportService } from './support.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';

/** Customer-facing support routes — always scoped to the JWT's user. */
@UseGuards(JwtGuard)
@Controller('support/tickets')
export class SupportController {
  constructor(private supportService: SupportService) {}

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  create(@Req() req: any, @Body() body: CreateTicketDto) {
    return this.supportService.createTicket(req.user.userId, body);
  }

  @Get()
  list(@Req() req: any) {
    return this.supportService.listCustomerTickets(req.user.userId);
  }

  @Get(':id')
  get(@Req() req: any, @Param('id') id: string) {
    return this.supportService.getCustomerTicket(req.user.userId, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/messages')
  reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CreateMessageDto,
  ) {
    return this.supportService.addCustomerMessage(
      req.user.userId,
      id,
      body.message,
    );
  }
}
