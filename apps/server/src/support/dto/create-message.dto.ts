import { IsString, Matches, MaxLength } from 'class-validator';

import { MESSAGE_MAX_LENGTH } from './create-ticket.dto';

export class CreateMessageDto {
  @IsString()
  @Matches(/\S/, { message: 'Message is required.' })
  @MaxLength(MESSAGE_MAX_LENGTH)
  message: string;
}
