import { Injectable, Logger } from '@nestjs/common';
import {
  PAYMENT_SERVICE,
  PaymentService,
  CreateCustomerInput,
  PaymentMethodResult,
} from './payment.service';

/**
 * LEGACY Razorpay customer + saved-card management (see payment.service.ts).
 * Can list and delete saved card tokens; deliberately cannot charge them.
 *
 * If RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set, runs in mock mode
 * (local/dev only — production refuses to boot without credentials).
 */
@Injectable()
export class RazorpayPaymentService implements PaymentService {
  private readonly logger = new Logger(RazorpayPaymentService.name);
  private readonly razorpay: any;

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (keyId && keySecret) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Razorpay = require('razorpay');
      this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      if (process.env.NODE_ENV === 'production' && !webhookSecret) {
        // Payments can be taken but incoming webhooks (payment confirmation,
        // failures, refunds) could never be verified — that's a silent
        // integrity hole, not something to boot into.
        throw new Error(
          'RAZORPAY_WEBHOOK_SECRET is not set. Refusing to start in production without it.',
        );
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Fail closed: a production deploy must never silently fall back to
      // mock billing just because credentials weren't set.
      throw new Error(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. Refusing to start in production without real payment credentials.',
      );
    } else {
      this.razorpay = null;
      this.logger.warn(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — running payment service in mock mode.',
      );
    }
  }

  isConfigured(): boolean {
    return !!this.razorpay;
  }

  private assertConfigured() {
    if (!this.razorpay) {
      throw new Error(
        'Payment provider is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.',
      );
    }
  }

  async createCustomer(input: CreateCustomerInput): Promise<string> {
    this.assertConfigured();
    const customer = await this.razorpay.customers.create({
      email: input.email,
      name: input.name || undefined,
      contact: input.contact || undefined,
      notes: { userId: input.userId },
    });
    return customer.id;
  }

  async customerExists(customerId: string): Promise<boolean> {
    this.assertConfigured();
    try {
      await this.razorpay.customers.fetch(customerId);
      return true;
    } catch (e: any) {
      // Razorpay answers 404 for malformed ids and 400 "The id provided does
      // not exist" for well-formed ids from another account/mode.
      const description = e?.error?.description ?? '';
      if (
        e?.statusCode === 404 ||
        (e?.statusCode === 400 && /does not exist/i.test(description))
      ) {
        return false;
      }
      throw e;
    }
  }

  async updateCustomerContact(
    customerId: string,
    contact: string,
  ): Promise<void> {
    this.assertConfigured();
    await this.razorpay.customers.edit(customerId, { contact });
  }

  async getPaymentMethods(customerId: string): Promise<PaymentMethodResult[]> {
    this.assertConfigured();
    try {
      const res = await this.razorpay.customers.fetchTokens(customerId);
      const items: any[] = Array.isArray(res)
        ? res
        : (res?.items ?? res?.data ?? []);
      return items.map((t: any) =>
        this.toPaymentMethod(t, t?.token ?? t?.id ?? null),
      );
    } catch {
      return [];
    }
  }

  async getPaymentMethod(
    customerId: string,
    tokenId: string,
  ): Promise<PaymentMethodResult | null> {
    this.assertConfigured();
    try {
      const t = await this.razorpay.customers.fetchToken(customerId, tokenId);
      return this.toPaymentMethod(t, t?.token ?? tokenId);
    } catch {
      return null;
    }
  }

  async deletePaymentMethod(
    customerId: string,
    tokenId: string,
  ): Promise<void> {
    this.assertConfigured();
    await this.razorpay.customers.deleteToken(customerId, tokenId);
  }

  private toPaymentMethod(t: any, id: string): PaymentMethodResult {
    const card = t?.card || t || {};
    return {
      id,
      brand: card?.network ?? card?.brand ?? card?.issuer ?? null,
      last4: card?.last4 ?? card?.last_4 ?? card?.lastFour ?? null,
      expMonth: this.readCardNumber(
        card,
        'expirymonth',
        'expiry_month',
        'expMonth',
      ),
      expYear: this.readCardNumber(
        card,
        'expiryyear',
        'expiry_year',
        'expYear',
      ),
    };
  }

  private readCardNumber(card: any, ...keys: string[]): number | null {
    const value = keys
      .map((key) => card?.[key])
      .find((candidate) => candidate != null);
    return value != null && value !== '' ? Number(value) : null;
  }
}

export const RazorpayPaymentServiceProvider = {
  provide: PAYMENT_SERVICE,
  useFactory: () => new RazorpayPaymentService(),
};
