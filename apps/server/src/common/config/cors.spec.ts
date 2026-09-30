import { corsOriginCallback, socketOriginCallback } from './cors';

describe('origin policies', () => {
  it('allows customer origins to attempt Socket.IO and leaves token authorization to the gateway', () => {
    const callback = jest.fn();
    socketOriginCallback('https://customer.example', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('allows public SDK API origins without requiring a global customer domain list', () => {
    const callback = jest.fn();
    corsOriginCallback('https://customer.example', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });
});
