import { Global, Module } from '@nestjs/common';

import { ExchangeRateService } from './exchange-rate.service';

@Global()
@Module({
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class ExchangeRateModule {}
