import { DEFAULT_USD_INR_RATE, resetLiveUsdInrRate, setLiveUsdInrRate, usdInrRate } from './exchange-rate';
import { ExchangeRateService } from './exchange-rate.service';

describe('usdInrRate', () => {
  const env = process.env.AI_USD_INR_RATE;
  beforeEach(() => {
    delete process.env.AI_USD_INR_RATE;
    resetLiveUsdInrRate();
  });
  afterAll(() => {
    if (env === undefined) delete process.env.AI_USD_INR_RATE;
    else process.env.AI_USD_INR_RATE = env;
    resetLiveUsdInrRate();
  });

  it('uses the default until a live rate arrives, then the live rate', () => {
    expect(usdInrRate()).toBe(DEFAULT_USD_INR_RATE);
    setLiveUsdInrRate(95.16, 'test');
    expect(usdInrRate()).toBe(95.16);
  });

  it('ignores implausible rates and keeps the last good one', () => {
    setLiveUsdInrRate(95, 'test');
    setLiveUsdInrRate(0.0105, 'test'); // an INR → USD rate by mistake
    setLiveUsdInrRate(Number.NaN, 'test');
    expect(usdInrRate()).toBe(95);
  });

  it('AI_USD_INR_RATE pins the rate', () => {
    setLiveUsdInrRate(95, 'test');
    process.env.AI_USD_INR_RATE = '90';
    expect(usdInrRate()).toBe(90);
  });
});

describe('ExchangeRateService.refresh', () => {
  const realFetch = global.fetch;
  beforeEach(() => resetLiveUsdInrRate());
  afterEach(() => {
    global.fetch = realFetch;
    resetLiveUsdInrRate();
  });
  const respond = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);

  it('takes the first source that answers', async () => {
    global.fetch = jest.fn().mockImplementation(() => respond({ rates: { INR: 94.94 } }));
    expect(await new ExchangeRateService().refresh()).toBe(94.94);
    expect(usdInrRate()).toBe(94.94);
  });

  it('falls back to the second source, and keeps the last rate when both fail', async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(() => respond({}, false))
      .mockImplementationOnce(() => respond({ rates: { INR: 95.16 } }));
    expect(await new ExchangeRateService().refresh()).toBe(95.16);
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await new ExchangeRateService().refresh()).toBeNull();
    expect(usdInrRate()).toBe(95.16);
  });
});
