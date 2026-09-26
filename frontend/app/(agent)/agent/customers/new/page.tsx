"use client";

import { useEffect, useState } from "react";
import StockFlowSelect from "@/components/ui/custom/stockFlowSelect";
import { customerApi } from "@/lib/api/customer";
import { transportApi } from "@/lib/api/transport";
import { toastSuccess, toastError } from "@/lib/toast";
import { CustomerCreateRequest } from "@/types/customer";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { AgentResponse } from "@/types/agent";
import { agentApi } from "@/lib/api/agents";

export default function NewCustomerPage() {
  const [formData, setFormData] = useState({
    customerName: "",
    address: "",
    contactNumber: "",
    gst: "",
    preferredTransport: "",
  });
  const [agent, setAgent] = useState<AgentResponse | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transports, setTransports] = useState<
    { value: string; label: string }[]
  >([]);
  const [loadingTransports, setLoadingTransports] = useState(true);

  const { user } = useAuth();
  const router = useRouter();

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  useEffect(() => {
    const fetchTransports = async () => {
      setLoadingTransports(true);
      try {
        const response = await transportApi.getActive();
        setTransports(
          response.map((t) => ({ value: t.id.toString(), label: t.name })),
        );
      } catch (error) {
        console.error("Error fetching transports:", error);
      } finally {
        setLoadingTransports(false);
      }
    };
    fetchTransports();

    agentApi.getProfile(user!.id).then((data) => setAgent(data));
  }, [user]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.customerName.trim())
      newErrors.customerName = "Customer name is required";
    if (!formData.address.trim()) newErrors.address = "Address is required";
    if (!formData.contactNumber.trim()) {
      newErrors.contactNumber = "Contact number is required";
    } else if (!/^\+?[\d\s-]{10,}$/.test(formData.contactNumber)) {
      newErrors.contactNumber = "Invalid contact number format";
    }
    if (!formData.gst.trim()) {
      newErrors.gst = "GST number is required";
    } else if (
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
        formData.gst.toUpperCase(),
      )
    ) {
      newErrors.gst = "Invalid GST format (e.g. 29ABCDE1234F1Z5)";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload: CustomerCreateRequest = {
        name: formData.customerName,
        gst: formData.gst.toUpperCase(),
        address: formData.address,
        contact: formData.contactNumber,
        agent: Number(agent?.id),
        preferred_transport: formData.preferredTransport
          ? parseInt(formData.preferredTransport)
          : null,
      };
      await customerApi.create(payload);
      toastSuccess("Customer created successfully");
      router.push("/agent/customers");
    } catch (error: any) {
      console.error("Error creating customer:", error);
      toastError("Failed to create customer", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">
          New Customer
        </h1>
        <p className="text-sm text-gray-400 font-medium">
          Register a new client in the system
        </p>
      </div>

      <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 mb-8">
        <FieldGroup className="space-y-6">
          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Customer / Shop Name
              </FieldLabel>
              {errors.customerName && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.customerName}
                </span>
              )}
            </div>
            <Input
              placeholder="e.g. Fashion Hub"
              value={formData.customerName}
              onChange={(e) => handleChange("customerName", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.customerName ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Shipping Address
              </FieldLabel>
              {errors.address && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.address}
                </span>
              )}
            </div>
            <Textarea
              rows={3}
              placeholder="Full mailing address..."
              value={formData.address}
              onChange={(e) => handleChange("address", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl focus:ring-primary/10 transition-all ${errors.address ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Contact Detail
              </FieldLabel>
              {errors.contactNumber && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.contactNumber}
                </span>
              )}
            </div>
            <Input
              placeholder="+91 98765 43210"
              value={formData.contactNumber}
              onChange={(e) => handleChange("contactNumber", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.contactNumber ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                GST Number
              </FieldLabel>
              {errors.gst && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.gst}
                </span>
              )}
            </div>
            <Input
              placeholder="e.g. 29ABCDE1234F1Z5"
              value={formData.gst}
              onChange={(e) =>
                handleChange("gst", e.target.value.toUpperCase())
              }
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${
                errors.gst
                  ? "border-red-200 focus:border-red-300"
                  : "focus:border-primary"
              }`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Preferred Transport
              </FieldLabel>
            </div>
            <StockFlowSelect
              value={formData.preferredTransport}
              onChange={(val) => handleChange("preferredTransport", val)}
              options={[{ value: "", label: "None" }, ...transports]}
              disabled={loadingTransports}
            />
          </Field>
        </FieldGroup>
      </div>

      <div className="flex gap-4 items-center mt-auto pb-10">
        <StockFlowButton
          variant="outline"
          text="Cancel"
          onClick={() => router.back()}
          className="flex-1 h-14 rounded-2xl border-gray-200 font-bold text-gray-500 active:scale-95 transition-all text-sm"
        />
        <StockFlowButton
          variant="filled"
          text={isSubmitting ? "Creating..." : "Add Customer"}
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-[2] h-14 rounded-2xl bg-primary shadow-lg shadow-primary/20 font-bold text-white active:scale-95 transition-all text-sm"
        />
      </div>
    </div>
  );
}
