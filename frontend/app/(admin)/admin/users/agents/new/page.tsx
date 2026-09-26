"use client";

import { useState, useEffect } from "react";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { agentApi } from "@/lib/api/agents";
import { toastSuccess, toastError } from "@/lib/toast";
import { deriveUsername } from "@/lib/utils/deriveUsername";
import { useRouter } from "next/navigation";

export default function NewAgentPage() {
  const [formData, setFormData] = useState({
    displayName: "",
    email: "",
    contactNumber: "",
    password: "",
  });
  const [existingUsernames, setExistingUsernames] = useState<Set<string>>(
    new Set(),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    agentApi
      .getAll()
      .then((agents) => {
        setExistingUsernames(new Set(agents.map((a) => a.user.username)));
      })
      .catch(() => {});
  }, []);

  const router = useRouter();

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
    if (errors[key]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.displayName.trim())
      newErrors.displayName = "Name is required";
    if (!formData.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = "Invalid email format";
    }
    if (!formData.password.trim()) {
      newErrors.password = "Password is required";
    } else if (formData.password.length < 6) {
      newErrors.password = "Minimum 6 characters required";
    }
    if (!formData.contactNumber.trim()) {
      newErrors.contactNumber = "Contact number is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const username = deriveUsername(formData.displayName, existingUsernames);
      const payload = {
        username,
        display_name: formData.displayName,
        email: formData.email,
        contact: formData.contactNumber,
        password: formData.password,
      };
      const newAgent = await agentApi.create(payload);
      toastSuccess("Agent created successfully");
      router.push(`/admin/users/agents/${newAgent.id}`);
    } catch (error: any) {
      toastError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-900 tracking-tight">
          New Agent
        </h1>
        <p className="text-sm text-gray-400 font-medium">
          Create a new field agent account
        </p>
      </div>

      <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 mb-8">
        <FieldGroup className="space-y-6 flex-1">
          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Display Name
              </FieldLabel>
              {errors.displayName && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.displayName}
                </span>
              )}
            </div>
            <Input
              placeholder="e.g. John Doe"
              value={formData.displayName}
              onChange={(e) => handleChange("displayName", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.displayName ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
            {formData.displayName.trim() && (
              <p className="mt-1.5 text-[11px] text-gray-400">
                Username:{" "}
                <span className="font-mono font-medium text-gray-600">
                  {deriveUsername(formData.displayName, existingUsernames)}
                </span>
              </p>
            )}
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Email Address
              </FieldLabel>
              {errors.email && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.email}
                </span>
              )}
            </div>
            <Input
              type="email"
              placeholder="agent@example.com"
              value={formData.email}
              onChange={(e) => handleChange("email", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.email ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Secure Password
              </FieldLabel>
              {errors.password && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.password}
                </span>
              )}
            </div>
            <Input
              type="password"
              placeholder="Minimum 6 characters"
              value={formData.password}
              onChange={(e) => handleChange("password", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.password ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
            />
          </Field>

          <Field>
            <div className="flex justify-between items-center mb-1.5">
              <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                Contact detail
              </FieldLabel>
              {errors.contactNumber && (
                <span className="text-[10px] text-red-500 font-bold">
                  {errors.contactNumber}
                </span>
              )}
            </div>
            <Input
              placeholder="+91 xxxxx xxxxx"
              value={formData.contactNumber}
              onChange={(e) => handleChange("contactNumber", e.target.value)}
              className={`bg-white border-gray-100 rounded-xl h-12 focus:ring-primary/10 ${errors.contactNumber ? "border-red-200 focus:border-red-300" : "focus:border-primary"}`}
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
          text={isSubmitting ? "Creating..." : "Create Agent"}
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="flex-[2] h-14 rounded-2xl bg-primary shadow-lg shadow-primary/20 font-bold text-white active:scale-95 transition-all text-sm"
        />
      </div>
    </div>
  );
}
