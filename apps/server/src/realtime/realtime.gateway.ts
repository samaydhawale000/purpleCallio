import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';

import { socketOriginCallback } from '../common/config/cors';
import { PrismaService } from '../prisma/prisma.service';

const userRoom = (userId: string) => `user:${userId}`;
const ADMINS_ROOM = 'admins';

/**
 * Dashboard push channel (`/realtime` namespace), separate from the call
 * signaling gateway on the default namespace. Authenticated with the same
 * dashboard JWT as the REST API. Events are deliberately thin — they say
 * *what* changed (ids only) and clients refetch through the authorized REST
 * endpoints, so nothing sensitive travels over the socket and access rules
 * live in one place.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: socketOriginCallback, credentials: false },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string' || !token) throw new Error('missing token');
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        {
          secret: process.env.JWT_ACCESS_SECRET,
        },
      );
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true },
      });
      if (!user) throw new Error('unknown user');

      await client.join(userRoom(user.id));
      if (user.role === 'ADMIN') await client.join(ADMINS_ROOM);
    } catch {
      client.disconnect(true);
    }
  }

  emitToUser(
    userId: string,
    event: string,
    data: Record<string, unknown> = {},
  ) {
    this.emit(userRoom(userId), event, data);
  }

  emitToAdmins(event: string, data: Record<string, unknown> = {}) {
    this.emit(ADMINS_ROOM, event, data);
  }

  private emit(room: string, event: string, data: Record<string, unknown>) {
    try {
      this.server?.to(room).emit(event, data);
    } catch (err) {
      // Push is best-effort; clients also refresh on navigation/polling.
      this.logger.warn(`Realtime emit ${event} failed: ${String(err)}`);
    }
  }
}
