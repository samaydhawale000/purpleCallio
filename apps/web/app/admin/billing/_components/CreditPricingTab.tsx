"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  cancelCreditPricing,
  createCreditPricingDraft,
  listCreditPricing,
  grantPromotionalCredits,
  previewCreditPricing,
  publishCreditPricing,
  updateCreditPricingDraft,
  type AdminCreditPricingVersion,
  type CreditPricingInput,
} from "../../../lib/admin-billing";
import { formatDate, formatMoney } from "../../../lib/billing";
import { Button } from "../../../components/ui/Button";
import {
  ErrorText,
  Field,
  inputCls,
  Panel,
  Spinner,
  Table,
  tdCls,
  thCls,
  rowCls,
  useAdminErrorHandler,
  useResource,
} from "./ui";
import { useCanWrite } from "../../../lib/admin-access";

type Form = {
  currency: string;
  price: string;
  minimumPurchase: string;
  validity: string;
};
type Feedback = { text: string; tone: "success" | "error" };
const empty: Form = {
  currency: "INR",
  price: "",
  minimumPurchase: "1000.00",
  validity: "365",
};
const toMinor = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return NaN;
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : NaN;
};
const moneyInput = (minor: number | null) =>
  minor == null ? "" : (minor / 100).toFixed(2);
const toInput = (v: AdminCreditPricingVersion): Form => ({
  currency: v.currency,
  price: moneyInput(v.creditPricePaise),
  minimumPurchase: moneyInput(v.minimumPurchasePaise),
  validity: String(v.purchasedValidityDays),
});

export function CreditPricingTab() {
  const handle = useAdminErrorHandler();
  const { data, loading, error, reload } = useResource(listCreditPricing, []);
  const [form, setForm] = useState<Form>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    examples: { purchaseAmountPaise: number; credits: number }[];
    rounding: string;
  } | null>(null);
  const [pricingFeedback, setPricingFeedback] = useState<Feedback | null>(null);
  const [promoFeedback, setPromoFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [promo, setPromo] = useState({
    userId: "",
    credits: "",
    reason: "",
    validityDays: "30",
    campaignReference: "",
  });
  const promoIdempotencyKey = useRef<string | null>(null);
  const canWrite = useCanWrite();

  const makeInput = (): CreditPricingInput => ({
    currency: form.currency.trim().toUpperCase(),
    creditPricePaise: toMinor(form.price),
    minimumPurchasePaise: toMinor(form.minimumPurchase),
    purchasedValidityDays: Number(form.validity),
  });

  useEffect(() => {
    if (form.price)
      void previewCreditPricing(makeInput())
        .then((p) => setPreview(p))
        .catch(() => setPreview(null));
  }, [form]);

  if (loading) return <Spinner />;
  if (error || !data)
    return <ErrorText>{error || "Failed to load pricing versions."}</ErrorText>;

  const editingDraft = editing
    ? data.versions.find((version) => version.id === editing)
    : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPricingFeedback(null);
    setBusy(true);
    try {
      const input = makeInput();
      if (
        !Number.isSafeInteger(input.creditPricePaise) ||
        (input.creditPricePaise ?? 0) < 1
      )
        throw new Error(
          "Enter a price greater than zero, up to 2 decimal places.",
        );
      if (
        !Number.isSafeInteger(input.minimumPurchasePaise) ||
        input.minimumPurchasePaise < input.creditPricePaise
      )
        throw new Error(
          "Enter a minimum purchase that buys at least one whole credit.",
        );
      if (
        !Number.isSafeInteger(input.purchasedValidityDays) ||
        (input.purchasedValidityDays ?? 0) < 1 ||
        (input.purchasedValidityDays ?? 0) > 3650
      )
        throw new Error(
          "Purchased credit validity must be between 1 and 3650 days.",
        );
      const saved = editing
        ? await updateCreditPricingDraft(editing, input)
        : await createCreditPricingDraft(input);
      setEditing(saved.id);
      setPricingFeedback({
        text: `Draft v${saved.version} saved. Live customer pricing is unchanged.`,
        tone: "success",
      });
      reload();
    } catch (e) {
      setPricingFeedback({
        text: handle(e, "Could not save the draft."),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (v: AdminCreditPricingVersion) => {
    setEditing(v.id);
    setForm(toInput(v));
    setPricingFeedback(null);
  };
  const publish = async (v: AdminCreditPricingVersion) => {
    if (
      !window.confirm(
        `Publish pricing v${v.version} for ${v.currency}? This changes new checkout quotes.`,
      )
    )
      return;
    setBusy(true);
    setPricingFeedback(null);
    try {
      await publishCreditPricing(v.id);
      setPricingFeedback({
        text: `Pricing v${v.version} published or scheduled.`,
        tone: "success",
      });
      setEditing(null);
      setForm(empty);
      reload();
    } catch (e) {
      setPricingFeedback({
        text: handle(e, "Could not publish pricing."),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (v: AdminCreditPricingVersion) => {
    if (!window.confirm(`Cancel unpublished pricing v${v.version}?`)) return;
    try {
      await cancelCreditPricing(v.id);
      setPricingFeedback({
        text: `Pricing v${v.version} cancelled.`,
        tone: "success",
      });
      reload();
    } catch (e) {
      setPricingFeedback({
        text: handle(e, "Could not cancel pricing."),
        tone: "error",
      });
    }
  };

  const grantPromo = async (e: FormEvent) => {
    e.preventDefault();
    setPromoFeedback(null);
    setBusy(true);
    try {
      promoIdempotencyKey.current ??= crypto.randomUUID();
      const result = await grantPromotionalCredits({
        userId: promo.userId.trim(),
        credits: Number(promo.credits),
        reason: promo.reason.trim(),
        validityDays: Number(promo.validityDays),
        campaignReference: promo.campaignReference.trim() || undefined,
        idempotencyKey: promoIdempotencyKey.current,
      });
      setPromoFeedback({
        text: `Granted ${Number(promo.credits).toLocaleString()} promotional credits. Bucket ${result.bucketId} expires ${new Date(result.expiresAt).toLocaleDateString()}.`,
        tone: "success",
      });
      setPromo({ ...promo, credits: "", reason: "", campaignReference: "" });
      promoIdempotencyKey.current = null;
    } catch (e) {
      setPromoFeedback({
        text: handle(e, "Could not grant promotional credits."),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Published credit price"
        subtitle="Amount-based purchases use the rate published here. Eligible customers can configure Auto Top-Up with a Razorpay eMandate, a balance threshold, a purchase amount and a monthly maximum."
      >
        {data.active ? (
          <div className="text-sm text-[#170B2E]">
            Version {data.active.version} ·{" "}
            {formatMoney(data.active.creditPricePaise, data.active.currency)}{" "}
            per credit · minimum{" "}
            {formatMoney(
              data.active.minimumPurchasePaise,
              data.active.currency,
            )}{" "}
            · {data.active.purchasedValidityDays} day lot validity
          </div>
        ) : (
          <p className="text-sm text-amber-800">
            No active rate. Customers cannot use amount based credit checkout
            until an administrator publishes one.
          </p>
        )}
      </Panel>
      {canWrite && (
        <Panel
          title={editing ? "Edit pricing draft" : "Create pricing draft"}
          subtitle="Set the selling price of one credit. Draft changes do not affect checkout; publication requires confirmation."
        >
          <form onSubmit={submit} className="space-y-4">
            {editingDraft && (
              <p className="rounded-lg bg-[#F8F4FD] p-3 text-sm">
                Editing draft v{editingDraft.version}:{" "}
                {form.price && Number.isSafeInteger(toMinor(form.price))
                  ? `${formatMoney(toMinor(form.price), form.currency)} per credit`
                  : "enter a valid price per credit"}
                . The currently published rate remains{" "}
                {data.active
                  ? `${formatMoney(data.active.creditPricePaise, data.active.currency)} per credit`
                  : "unset"}{" "}
                until this draft is published.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Currency">
                <select
                  className={inputCls}
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value })
                  }
                >
                  <option value="INR">INR — Indian Rupee</option>
                </select>
              </Field>
              <Field
                label={`Price per credit (${form.currency || "currency"})`}
                hint="Enter a positive price with up to 2 decimal places; amounts are stored in paise."
              >
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                />
              </Field>
              <Field
                label={`Minimum purchase (${form.currency || "currency"})`}
                hint="The smallest amount a customer can add to their wallet. GST is calculated separately at checkout."
              >
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.minimumPurchase}
                  onChange={(e) =>
                    setForm({ ...form, minimumPurchase: e.target.value })
                  }
                />
              </Field>
              <Field label="Purchased credit validity (days)">
                <input
                  className={inputCls}
                  type="number"
                  min="1"
                  value={form.validity}
                  onChange={(e) =>
                    setForm({ ...form, validity: e.target.value })
                  }
                />
              </Field>
            </div>
            {preview && (
              <div className="rounded-lg bg-[#F8F4FD] p-3 text-xs">
                Preview:{" "}
                {preview.examples
                  .map(
                    (x) =>
                      `${formatMoney(x.purchaseAmountPaise, form.currency)} → ${x.credits.toLocaleString()} credits`,
                  )
                  .join(" · ")}
                <p className="mt-1">{preview.rounding}</p>
              </div>
            )}
            <FeedbackMessage feedback={pricingFeedback} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : editing ? "Save draft" : "Create draft"}
              </Button>
              {editing && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setEditing(null);
                    setForm(empty);
                  }}
                >
                  New draft
                </Button>
              )}
            </div>
          </form>
        </Panel>
      )}
      <Panel
        title="Pricing history"
        subtitle="Published versions remain immutable; drafts can be edited or cancelled."
      >
        <Table
          headers={[
            "Version",
            "Currency / rate",
            "Validity",
            "Effective",
            "Status",
            "Responsible admin",
            "Actions",
          ]}
          empty={data.versions.length ? undefined : "No pricing versions yet."}
        >
          {data.versions.map((v) => (
            <tr key={v.id} className={rowCls}>
              <td className={tdCls}>v{v.version}</td>
              <td className={tdCls}>
                {formatMoney(v.creditPricePaise, v.currency)} / credit
              </td>
              <td className={tdCls}>{v.purchasedValidityDays} days</td>
              <td className={tdCls}>{formatDate(v.effectiveAt)}</td>
              <td className={tdCls}>{v.status}</td>
              <td className={tdCls}>{v.publishedById ?? v.createdById}</td>
              <td className={tdCls}>
                {v.status === "DRAFT" && canWrite && (
                  <div className="flex gap-2">
                    <button
                      className="text-xs text-[#6425C4]"
                      onClick={() => startEdit(v)}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      className="text-xs text-[#6425C4]"
                      onClick={() => publish(v)}
                    >
                      Publish
                    </button>
                    <button
                      className="text-xs text-red-600"
                      onClick={() => cancel(v)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      {canWrite && (
        <Panel
          title="Grant promotional credits"
          subtitle="Free credits for one customer, recorded in a separate promotional bucket with an expiry, reason, campaign reference, and issuing administrator. They pay for audio, video and screen share only, never AI features."
        >
          <form className="grid gap-4 sm:grid-cols-3" onSubmit={grantPromo}>
            <Field label="Customer user ID">
              <input
                required
                className={inputCls}
                value={promo.userId}
                onChange={(e) => setPromo({ ...promo, userId: e.target.value })}
              />
            </Field>
            <Field label="Credits">
              <input
                required
                type="number"
                min="1"
                className={inputCls}
                value={promo.credits}
                onChange={(e) =>
                  setPromo({ ...promo, credits: e.target.value })
                }
              />
            </Field>
            <Field label="Validity (days)">
              <input
                required
                type="number"
                min="1"
                max="3650"
                className={inputCls}
                value={promo.validityDays}
                onChange={(e) =>
                  setPromo({ ...promo, validityDays: e.target.value })
                }
              />
            </Field>
            <Field label="Reason">
              <input
                required
                maxLength={300}
                className={inputCls}
                value={promo.reason}
                onChange={(e) => setPromo({ ...promo, reason: e.target.value })}
              />
            </Field>
            <Field label="Campaign reference (optional)">
              <input
                className={inputCls}
                value={promo.campaignReference}
                onChange={(e) =>
                  setPromo({ ...promo, campaignReference: e.target.value })
                }
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={busy}>
                Grant credits
              </Button>
            </div>
          </form>
          <FeedbackMessage feedback={promoFeedback} />
        </Panel>
      )}
    </div>
  );
}

function FeedbackMessage({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={
        feedback.tone === "error"
          ? "text-sm text-red-700"
          : "text-sm text-emerald-700"
      }
    >
      {feedback.text}
    </p>
  );
}
