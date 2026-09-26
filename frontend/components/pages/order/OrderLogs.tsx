"use client";
import { useState, useEffect } from "react";
import { orderApi, OrderLog } from "@/lib/api/order";
import { History, ChevronDown, ChevronUp } from "lucide-react";

interface OrderLogsProps {
  orderId: number;
}

const actionLabels: Record<string, { label: string; color: string }> = {
  ITEM_DELETED: { label: "Item Deleted", color: "text-red-600 bg-red-50" },
  ORDER_DELETED: { label: "Order Deleted", color: "text-red-600 bg-red-50" },
  ORDER_EDITED: { label: "Order Edited", color: "text-blue-600 bg-blue-50" },
  DISPATCHED: { label: "Dispatched", color: "text-green-600 bg-green-50" },
};

export default function OrderLogs({ orderId }: OrderLogsProps) {
  const [logs, setLogs] = useState<OrderLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const data = await orderApi.getOrderLogs(orderId);
        setLogs(data);
      } catch (error) {
        console.error("Error fetching logs:", error);
      } finally {
        setLoading(false);
      }
    };

    if (expanded) {
      fetchLogs();
    }
  }, [expanded, orderId]);

  if (logs.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        <History size={16} />
        <span>View Activity Logs</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading logs...</p>
          ) : (
            logs.map((log) => {
              const actionInfo = actionLabels[log.action] || { label: log.action, color: "text-gray-600 bg-gray-50" };
              const date = new Date(log.created_at);
              const formattedDate = date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div key={log.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${actionInfo.color}`}>
                      {actionInfo.label}
                    </span>
                    <span className="text-xs text-gray-400">{formattedDate}</span>
                  </div>
                  {log.performed_by && (
                    <p className="text-xs text-gray-500">By: {log.performed_by}</p>
                  )}
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div className="mt-2 text-xs text-gray-600">
                      {Object.entries(log.details).map(([key, value]) => (
                        <p key={key}>
                          {key.replace(/_/g, " ")}: {String(value)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}