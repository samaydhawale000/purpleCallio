import { Module } from '@nestjs/common';
import { PAYMENT_SERVICE } from './payment.service';
import { RazorpayPaymentServiceProvider } from './razorpay-payment.service';
import { PAYMENT_PROVIDER } from './providers/payment-provider';
import { RazorpayProvider } from './providers/razorpay.provider';

@Module({
  providers: [
    // LEGACY saved-card management (listing/removing pay-as-you-go cards).
    RazorpayPaymentServiceProvider,
    // Prepaid checkout provider. Swap/extend here to add Stripe etc.
    RazorpayProvider,
    { provide: PAYMENT_PROVIDER, useExisting: RazorpayProvider },
  ],
  exports: [PAYMENT_SERVICE, PAYMENT_PROVIDER],
})
export class PaymentModule {}
