"use client";

import { useState, useEffect } from "react";
import { ArrowRightLeft, Copy, X } from "lucide-react";
import StockFlowSelect from "@/components/ui/custom/stockFlowSelect";
import { agentApi } from "@/lib/api/agents";

interface TransferCopyItemsDialogProps {
  open: boolean;
  onClose: () => void;
  mode: "transfer" | "copy";
  sourceAgentId: number;
  sourceAgentName: string;
  onAction: (targetAgentId: number) => Promise<void>;
}

export default function TransferCopyItemsDialog({
  open,
  onClose,
  mode,
  sourceAgentId,
  sourceAgentName,
  onAction,
}: TransferCopyItemsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [transferOptions, setTransferOptions] = useState<
    { value: string; label: string }[]
  >([]);
  const [targetAgentId, setTargetAgentId] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const VISIBLE_LIMIT = 5;
  const visibleOptions = showAll
    ? transferOptions
    : transferOptions.slice(0, VISIBLE_LIMIT);
  const hiddenCount = transferOptions.length - VISIBLE_LIMIT;

  const isTransfer = mode === "transfer";
  const title = isTransfer ? "Transfer Items" : "Copy Items";
  const actionText = isTransfer ? "Transfer All" : "Copy All";
  const Icon = isTransfer ? ArrowRightLeft : Copy;
  const description = isTransfer
    ? `Move all items from ${sourceAgentName}.`
    : `Copy all items from ${sourceAgentName} to another agent.`;
  const instruction = isTransfer
    ? `Select the destination agent to transfer all items currently assigned to `
    : `Select the destination agent to copy all items currently assigned to `;

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    setError("");
    setTargetAgentId("");
    setShowAll(false);

    agentApi.getAll()
      .then((agents) => {
        const opts = agents
          .filter((a) => a.id !== sourceAgentId)
          .map((a) => ({
            value: a.id.toString(),
            label: a.user.display_name || a.user.username,
          }));
        setTransferOptions(opts);
      })
      .catch(() => setError("Failed to load agents"))
      .finally(() => setFetching(false));
  }, [open, sourceAgentId]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (!targetAgentId) {
      setError("Please select a target agent.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onAction(parseInt(targetAgentId));
      onClose();
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.detail ||
        "An error occurred.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full sm:max-w-md bg-white rounded-3xl shadow-2xl pb-safe animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-200">
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900">
                {title}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors flex-shrink-0 ml-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="h-px bg-gray-100 mx-6" />

        <div className="px-6 pt-5 pb-6 space-y-5">
          {fetching ? (
             <div className="flex justify-center p-4">
               <span className="w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
             </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {instruction}<span className="font-bold text-gray-900">{sourceAgentName}</span>.
              </p>
              <StockFlowSelect
                value={targetAgentId}
                onChange={(val) => {
                  setTargetAgentId(val);
                  setError("");
                }}
                options={visibleOptions}
                placeholder="Select Target Agent..."
                className="bg-white"
              />

              {!showAll && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="text-xs font-bold text-blue-500 hover:text-blue-600 transition-colors"
                >
                  Show {hiddenCount} more agent{hiddenCount > 1 ? "s" : ""}
                </button>
              )}

              {error && (
                <p className="text-center text-xs font-semibold text-red-500 bg-red-50 py-2 px-3 rounded-xl">
                  {error}
                </p>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 h-12 rounded-2xl border-2 border-gray-200 text-sm font-bold text-gray-500 hover:bg-gray-50 transition-all active:scale-95 disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={loading || !targetAgentId}
                  className="flex-1 h-12 rounded-2xl bg-blue-500 text-sm font-bold text-white flex items-center justify-center gap-2 hover:bg-blue-600 transition-all active:scale-95 disabled:opacity-40 shadow-lg shadow-blue-500/20"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Icon className="w-4 h-4" />
                      {actionText}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
