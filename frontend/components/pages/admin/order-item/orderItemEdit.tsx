"use client";

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import { fabricApi } from "@/lib/api/item";
import { OrderItem } from "@/types/order";
import { VariantAllItem, formatMeters, toMeters } from "@/types/item";

interface OrderItemEditModalProps {
  item: OrderItem;
  metres: string;
  variantId: number | null;
  metresError: string | null;
  setMetres: (value: string) => void;
  setVariantId: (value: number | null) => void;
  setMetresError: (value: string | null) => void;
  onClose: () => void;
  onSave: () => void;
  /** True while the save is in flight, so the buttons can lock. */
  saving?: boolean;
}

/**
 * Edit one fabric line: how many metres the customer needs, and which colour.
 * Everything else about the line -- rate, allocation -- follows from those two.
 */
const OrderItemEditModal: React.FC<OrderItemEditModalProps> = ({
  item,
  metres,
  variantId,
  metresError,
  setMetres,
  setVariantId,
  setMetresError,
  onClose,
  onSave,
  saving = false,
}) => {
  const [colours, setColours] = useState<VariantAllItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const all = await fabricApi.getAllVariants();
        if (cancelled) return;
        setColours(all.filter((variant) => variant.fabric_id === item.fabric));
      } catch {
        // Leave the colour list empty; the metres field still works.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [item.fabric]);

  const alreadyPacked = toMeters(item.allocated_quantity);
  const selected = colours.find((colour) => colour.id === variantId);

  return (
    <Modal
      icon={<Pencil size={18} className="text-primary" />}
      iconBg="bg-primary/10"
      title={`Edit ${item.fabric_name}`}
      description={
        alreadyPacked > 0
          ? `${formatMeters(alreadyPacked)} m already packed. The order cannot be reduced below that.`
          : "Set the metres this customer needs."
      }
      onClose={onClose}
      actions={
        <>
          <ModalButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="line-metres"
            className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5"
          >
            Metres required
          </label>
          <input
            id="line-metres"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            autoFocus
            value={metres}
            onChange={(event) => {
              setMetres(event.target.value);
              if (metresError) setMetresError(null);
            }}
            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl font-medium text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          {metresError ? (
            <p className="mt-1.5 text-xs text-red-600">{metresError}</p>
          ) : selected ? (
            <p className="mt-1.5 text-xs text-gray-400">
              {formatMeters(selected.stock_meters)} m of this colour in stock
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="line-colour"
            className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5"
          >
            Colour
          </label>
          {loading ? (
            <p className="text-xs text-gray-400">Loading colours…</p>
          ) : (
            <select
              id="line-colour"
              value={variantId ?? ""}
              onChange={(event) =>
                setVariantId(
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl font-medium text-gray-900 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              {colours.map((colour) => (
                <option key={colour.id} value={colour.id}>
                  {colour.display_order || `Colour #${colour.id}`} ·{" "}
                  {formatMeters(colour.stock_meters)} m
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default OrderItemEditModal;
