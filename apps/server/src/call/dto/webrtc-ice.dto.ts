import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum IceOutcomeDto {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

const FAILURE_REASONS = [
  'SETUP_TIMEOUT',
  'ICE_FAILED',
  'ICE_DISCONNECTED',
  'MEDIA_STALLED',
  'SIGNALING_LOST',
  'RECOVERY_EXHAUSTED',
] as const;

export class WebrtcIceDto {
  @IsEnum(IceOutcomeDto)
  outcome: IceOutcomeDto;

  // Raw RTCIceConnectionState / RTCPeerConnectionState at report time — kept
  // for debugging, not itself used in any aggregate.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  iceConnectionState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  connectionState?: string;

  /** FAILED only. RECOVERY_EXHAUSTED = the client gave up after its ICE restarts. */
  @IsOptional()
  @IsIn(FAILURE_REASONS)
  reason?: string;

  /** With RECOVERY_EXHAUSTED: what started the failed recovery. */
  @IsOptional()
  @IsIn(FAILURE_REASONS)
  cause?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  iceRestarts?: number;
}
