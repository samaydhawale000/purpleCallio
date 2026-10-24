import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

/** Query strings stay strings (no transform); the service parses them. */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsISO8601({}, { message: 'from must be an ISO 8601 date.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be an ISO 8601 date.' })
  to?: string;
}

export class ListCallsQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @Matches(/^[1-9]\d{0,4}$/, { message: 'page must be a positive integer.' })
  page?: string;
}
