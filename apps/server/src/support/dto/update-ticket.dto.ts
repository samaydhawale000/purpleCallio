import { IsEnum } from 'class-validator';
import { SupportTicketStatus } from '@prisma/client';

export class UpdateTicketDto {
  @IsEnum(SupportTicketStatus, { message: 'Select a valid status.' })
  status: SupportTicketStatus;
}
