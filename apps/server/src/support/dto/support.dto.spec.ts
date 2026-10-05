import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateTicketDto, SUBJECT_MAX_LENGTH } from './create-ticket.dto';
import { UpdateTicketDto } from './update-ticket.dto';

async function errorsFor(cls: any, body: object) {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('support DTOs', () => {
  it('accepts a valid ticket', async () => {
    expect(
      await errorsFor(CreateTicketDto, {
        subject: 'Webhook not firing',
        message: 'Details',
        documentationId: 'react-native',
      }),
    ).toEqual([]);
  });

  it('rejects blank or overlong subject and message', async () => {
    expect(
      await errorsFor(CreateTicketDto, { subject: '   ', message: '' }),
    ).toEqual(['subject', 'message']);
    expect(
      await errorsFor(CreateTicketDto, {
        subject: 'x'.repeat(SUBJECT_MAX_LENGTH + 1),
        message: 'ok',
      }),
    ).toEqual(['subject']);
  });

  it('rejects malformed documentation ids', async () => {
    expect(
      await errorsFor(CreateTicketDto, {
        subject: 'ok',
        message: 'ok',
        documentationId: '../etc',
      }),
    ).toEqual(['documentationId']);
  });

  it('only accepts known statuses', async () => {
    expect(await errorsFor(UpdateTicketDto, { status: 'RESOLVED' })).toEqual(
      [],
    );
    expect(await errorsFor(UpdateTicketDto, { status: 'CLOSED' })).toEqual([
      'status',
    ]);
  });
});
