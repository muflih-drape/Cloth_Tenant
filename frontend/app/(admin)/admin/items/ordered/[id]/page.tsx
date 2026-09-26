"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Info, Users, AlertTriangle } from "lucide-react";
import { fabricApi } from "@/lib/api/item";
import { CustomerRequirementResponse, formatMeters, toMeters } from "@/types/item";
import { ImagePreview } from "@/components/pages/ImagePreview";
import { PageLoading } from "@/components/ui/Loading";

export default function CustomerRequirementsPage() {
  const params = useParams();
  const router = useRouter();
  const fabricId = Number(params.id);

  const [data, setData] = useState<CustomerRequirementResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fabricId) return;

    const fetchData = async () => {
      try {
        const result = await fabricApi.getCustomerRequirements(fabricId);
        setData(result);
      } catch (e) {
        console.error("Error fetching customer requirements:", e);
        setError("Failed to load fabric details");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [fabricId]);

  if (loading) {
    return <PageLoading text="Loading demand…" />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="p-4">
          <button
            onClick={() => router.replace("/admin/items?tab=ordered")}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="text-sm font-medium">Back</span>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
          <AlertTriangle size={48} className="mb-4" />
          <h2 className="text-lg font-bold">{error || "Fabric not found"}</h2>
          <button
            onClick={() => router.replace("/admin/items?tab=ordered")}
            className="mt-3 text-primary text-sm font-medium hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const totalOutstanding = data.customers.reduce(
    (sum, customer) => sum + toMeters(customer.outstanding_quantity),
    0,
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="p-4 flex items-center gap-3">
          <button
            onClick={() => router.replace("/admin/items?tab=ordered")}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-extrabold text-gray-900 truncate">
              {data.fabric.name}
            </h1>
            <p className="text-xs text-gray-400">
              ₹{Number(data.fabric.price_per_meter).toLocaleString("en-IN")}/m
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary Card */}
        <div className="bg-white rounded-md border border-gray-300 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-primary" />
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Open demand
              </h2>
            </div>
            <div className="bg-primary/10 text-primary rounded-full py-0.5 px-3 border border-primary/20">
              <span className="font-bold text-xs">{data.customers.length}</span>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Still to pack
              </p>
              <p className="text-sm font-black text-gray-900">
                {formatMeters(totalOutstanding)} m
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-medium">
                Colours waiting
              </p>
              <p className="text-sm font-black text-gray-900">
                {new Set(data.customers.map((c) => c.variant_display_order)).size}
              </p>
            </div>
          </div>
        </div>

        {/* Customer lines */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Info size={14} className="text-primary" />
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Waiting on
            </h2>
          </div>

          {data.customers.length === 0 ? (
            <div className="bg-white rounded-md border border-gray-300 p-6 text-center">
              <Info size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400">No open demand for this fabric</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.customers.map((customer, index) => (
                <div
                  key={`${customer.order_id}-${index}`}
                  className="bg-white rounded-md border border-gray-300 p-3 flex items-center gap-3"
                >
                  <div className="relative w-12 h-12 rounded-md bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-100">
                    {customer.variant_image ? (
                      <ImagePreview
                        src={customer.variant_image}
                        alt={customer.customer_name}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Info size={16} className="text-gray-300" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 truncate">
                      {customer.customer_name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-gray-400">
                        {customer.variant_display_order
                          ? `Colour #${customer.variant_display_order}`
                          : "No colour"}
                      </span>
                      {customer.agent && (
                        <>
                          <span className="text-gray-200">·</span>
                          <span className="text-[10px] text-gray-400">
                            {customer.agent}
                          </span>
                        </>
                      )}
                      <span className="text-gray-200">·</span>
                      <span className="text-[10px] text-gray-400">
                        Order #{customer.order_id}
                      </span>
                    </div>
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <div className="bg-gray-100 rounded-lg px-3 py-1.5">
                      <span className="text-sm font-black text-gray-900">
                        {formatMeters(customer.outstanding_quantity)} m
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      of {formatMeters(customer.ordered_quantity)} m
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
