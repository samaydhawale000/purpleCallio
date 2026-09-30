import { ConfigService } from '@nestjs/config';
import { TurnService } from './turn.service';
import { HttpException } from '@nestjs/common';

describe('TurnService', () => {
  it('issues short-lived, signed credentials to playground calls', () => {
    process.env.PLAYGROUND_TURN_CREDENTIAL_TTL_SECONDS = '60';
    const config = {
      get: (key: string) =>
        ({ TURN_SECRET: 'test-secret', TURN_SERVER: 'turn.example.test' })[key],
    } as unknown as ConfigService;
    const turn = new TurnService(config, {} as any);
    const before = Math.floor(Date.now() / 1000);
    const result = turn.getCredentials(true);
    const server = result.iceServers.find((entry) =>
      String(entry.urls).startsWith('turn:'),
    )!;
    expect(Number(server.username!.split(':')[0])).toBeGreaterThanOrEqual(
      before + 60,
    );
    expect(Number(server.username!.split(':')[0])).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 60,
    );
    expect(server.credential).toBeTruthy();
    delete process.env.PLAYGROUND_TURN_CREDENTIAL_TTL_SECONDS;
  });

  it('limits repeated playground TURN credential requests per call/IP', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      playgroundAttempt: {
        count: jest.fn().mockResolvedValue(3),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    } as any;
    const config = { get: () => 'secret' } as unknown as ConfigService;
    const turn = new TurnService(config, prisma);
    await expect(
      turn.getPlaygroundCredentials(
        'call-1',
        '127.0.0.1',
        new Date(Date.now() + 30_000),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(tx.playgroundAttempt.create).not.toHaveBeenCalled();
  });
});
