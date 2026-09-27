"use client";

import { useMemo, useState } from "react";
import { IndianRupee, Pencil } from "lucide-react";

import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import {
  discountPercent,
  formatRupees,
  hasMeaningfulChange,
  validateOverrideReason,
  validatePriceOverride,
} from "@/lib/priceOverride";

interface PriceOverrideDialogProps {
  /** The order total from the line arithmetic. The cap for an agent. */
  computedTotal: number;
  /** The figure currently billed -- the override when one exists. */
  currentTotal: number;
  isOverridden: boolean;
  /** Admins may set any total; agents may only reduce it. */
  canRaise: boolean;
  isSaving?: boolean;
  onSave: (total: number, reason: string) => void;
  onClose: () => void;
}

/**
 * Set the total an order is placed with. Reachable only while the order is
 * still a draft, because once placed the number is a commitment.
 */
export default function PriceOverrideDialog({
  computedTotal,
  currentTotal,
  isOverridden,
  canRaise,
  isSaving = false,
  onSave,
  onClose,
}: PriceOverrideDialogProps) {
  // The parent mounts this only while it is open, so these initialisers are the
  // re-seed: a cancelled or saved edit cannot leak into the next open.
  const [raw, setRaw] = useState(String(round2(currentTotal)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const check = useMemo(
    () => validatePriceOverride({ raw, computedTotal, canRaise }),
    [raw, computedTotal, canRaise],
  );

  const reasonError = validateOverrideReason(reason);
  const typed = check.ok ? check.total : 0;
  const saving = isSaving || !hasMeaningfulChange(typed, computedTotal, isOverridden);

  return (
    <Modal
      icon={<IndianRupee size={18} className="text-primary" />}
      iconBg="bg-primary/10"
      title={isOverridden ? "Adjust order total" : "Set order total"}
      description={`Order total from the lines is ${formatRupees(computedTotal)}.${canRaise ? "" : " You can reduce it, not increase it."}`}
      onClose={onClose}
      actions={
        <>
          <ModalButton variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            disabled={saving || !!reasonError || !check.ok}
            onClick={() => {
              if (!check.ok) {
                setError(check.error);
                return;
              }
              if (reasonError) {
                setError(reasonError);
                return;
              }
              setError(null);
              onSave(check.total, reason.trim());
            }}
          >
            {isSaving ? "Saving…" : "Save total"}
          </ModalButton>
        </>
      }
    >
      <div className="pt-1">
        <label
          htmlFor="price-override-total"
          className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5"
        >
          Total
        </label>
        <div className="relative">
          <IndianRupee
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            id="price-override-total"
            type="text"
            inputMode="decimal"
            autoFocus
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-900 focus:outline-none focus:border-primary"
          />
        </div>

        {check.ok && discountPercent(check.total, computedTotal) > 0 && (
          <p className="mt-1.5 text-xs font-bold text-emerald-600">
            {discountPercent(check.total, computedTotal)}% discount &middot;{" "}
            {formatRupees(round2(computedTotal - check.total))} off
          </p>
        )}

        <label
          htmlFor="price-override-reason"
          className="block text-xs font-bold text-gray-500 uppercase tracking-wide mt-3 mb-1.5"
        >
          Reason <span className="font-normal normal-case">(optional)</span>
        </label>
        <input
          id="price-override-reason"
          type="text"
          value={reason}
          maxLength={220}
          placeholder="Negotiated rate, bulk discount…"
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:border-primary"
        />

        {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

/** A small inline trigger, so the wizard does not need its own button styling. */
export function EditTotalButton({
  onClick,
  isOverridden,
  disabled,
}: {
  onClick: () => void;
  isOverridden: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 text-xs font-bold text-primary hover:underline disabled:opacity-40 disabled:no-underline disabled:hover:no-underline"
    >
      <Pencil size={12} />
      {isOverridden ? "Adjusted" : "Edit total"}
    </button>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
