import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum TransportDto {
  P2P = 'P2P',
  TURN = 'TURN',
}

const CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay'] as const;

/**
 * Client-reported media path from getStats(). Every field after `transport`
 * is optional so older SDKs keep working. No IP addresses or candidate
 * strings are accepted — only types, protocols and timings.
 */
export class WebrtcTransportDto {
  /** TURN if either selected candidate is a relay, else P2P. */
  @IsEnum(TransportDto)
  transport: TransportDto;

  // The raw RTCIceCandidate.type ('host' | 'srflx' | 'prflx' | 'relay') of
  // the local side of the selected pair.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  candidateType?: string;

  @IsOptional()
  @IsIn(CANDIDATE_TYPES)
  remoteCandidateType?: string;

  @IsOptional()
  @IsIn(['udp', 'tcp'])
  protocol?: string;

  /** Client → TURN leg when the local candidate is a relay. */
  @IsOptional()
  @IsIn(['udp', 'tcp', 'tls'])
  relayProtocol?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60_000)
  rttMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  availableOutgoingBitrate?: number;

  /** Negotiation start → ICE connected. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  setupMs?: number;

  /** Negotiation start → first inbound media bytes. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  firstMediaMs?: number;

  /** Inbound media was observed (not just an ICE state). */
  @IsOptional()
  @IsBoolean()
  mediaVerified?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  iceRestarts?: number;
}
