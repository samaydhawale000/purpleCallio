import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AdminGuard } from '../admin/guards/admin.guard';
import { SupportService } from './support.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

@UseGuards(AdminGuard)
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private supportService: SupportService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.supportService.listAdminTickets({ page, search, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.supportService.getAdminTicket(id);
  }

  @Post(':id/messages')
  reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: CreateMessageDto,
  ) {
    return this.supportService.addAdminMessage(
      req.user.userId,
      id,
      body.message,
    );
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTicketDto) {
    return this.supportService.updateStatus(id, body.status);
  }
}
