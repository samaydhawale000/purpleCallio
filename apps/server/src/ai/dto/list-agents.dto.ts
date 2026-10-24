import { IsUUID } from 'class-validator';

export class ListAgentsQueryDto {
  @IsUUID()
  projectId: string;
}
