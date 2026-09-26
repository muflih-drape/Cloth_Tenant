"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import heic2any from "heic2any";

import { brandApi } from "@/lib/api/brand";
import { toastSuccess, toastError } from "@/lib/toast";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { ArrowLeft, X, Camera } from "lucide-react";
import CropModal from "@/app/(admin)/admin/items/new/cropModal";
import { normalizeImageFile } from "@/lib/image-utils";

export default function NewBrandPage() {
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [formData, setFormData] = useState({
        name: "",
        phone: "",
        email: "",
        address_line1: "",
        address_line2: "",
        gst: "",
    });
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [cropSrc, setCropSrc] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleChange = (key: string, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) {
            setErrors((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }
    };

    const handleImageSelect = async (
        e: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const normalisedFile = await normalizeImageFile(file);

        setCropSrc(URL.createObjectURL(normalisedFile));
        e.target.value = "";
    };

    const handleCropConfirm = (file: File) => {
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
        setCropSrc(null);
    };

    const handleCropCancel = () => {
        setCropSrc(null);
    };

    const removeLogo = () => {
        setLogoFile(null);
        if (logoPreview) URL.revokeObjectURL(logoPreview);
        setLogoPreview(null);
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.name.trim()) newErrors.name = "Brand name is required";
        if (!formData.phone.trim())
            newErrors.phone = "Phone number is required";
        if (!formData.email.trim()) {
            newErrors.email = "Email is required";
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = "Invalid email format";
        }
        if (!formData.address_line1.trim())
            newErrors.address_line1 = "Address is required";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) return;

        setIsSubmitting(true);
        try {
            await brandApi.create({
                ...formData,
                logo: logoFile,
            });
            toastSuccess("Brand created successfully");
            router.push("/admin/settings/");
        } catch (error: any) {
            console.error("Error creating brand:", error);
            toastError("Failed to create brand", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
                <button
                    onClick={() => router.back()}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-50"
                >
                    <ArrowLeft size={24} />
                </button>
                <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                        Superuser
                    </p>
                    <h1 className="text-xl font-black leading-tight">
                        New Brand
                    </h1>
                </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 flex items-center gap-3">
                <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                    Superuser:
                </span>
                <span className="text-sm font-medium text-gray-700">
                    Create a new brand profile
                </span>
            </div>

            <div className="bg-gray-50/50 border border-gray-100 rounded-3xl p-6 mb-8">
                <FieldGroup className="space-y-6 flex-1">
                    {/* Logo upload */}
                    <Field>
                        <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                            Brand Logo
                        </FieldLabel>
                        {logoPreview ? (
                            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border border-gray-200">
                                <img
                                    src={logoPreview}
                                    alt="Logo preview"
                                    className="w-full h-full object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={removeLogo}
                                    className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full h-24 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-2 hover:border-primary/40 hover:bg-primary/5 transition-colors"
                            >
                                <Camera size={24} className="text-gray-300" />
                                <span className="text-xs font-medium text-gray-400">
                                    Upload logo
                                </span>
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleImageSelect}
                        />
                    </Field>

                    <Field>
                        <div className="flex justify-between items-center mb-1.5">
                            <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                Brand Name *
                            </FieldLabel>
                            {errors.name && (
                                <span className="text-[10px] text-red-500 font-bold">
                                    {errors.name}
                                </span>
                            )}
                        </div>
                        <Input
                            placeholder="e.g. XL Apparels"
                            value={formData.name}
                            onChange={(e) =>
                                handleChange("name", e.target.value)
                            }
                            className={`bg-white border-gray-100 rounded-xl h-12 ${errors.name ? "border-red-200" : "focus:border-primary"}`}
                        />
                    </Field>

                    <div className="grid grid-cols-2 gap-4">
                        <Field>
                            <div className="flex justify-between items-center mb-1.5">
                                <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                    Phone *
                                </FieldLabel>
                                {errors.phone && (
                                    <span className="text-[10px] text-red-500 font-bold">
                                        {errors.phone}
                                    </span>
                                )}
                            </div>
                            <Input
                                placeholder="Phone number"
                                value={formData.phone}
                                onChange={(e) =>
                                    handleChange("phone", e.target.value)
                                }
                                className={`bg-white border-gray-100 rounded-xl h-12 ${errors.phone ? "border-red-200" : "focus:border-primary"}`}
                            />
                        </Field>

                        <Field>
                            <div className="flex justify-between items-center mb-1.5">
                                <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                    Email *
                                </FieldLabel>
                                {errors.email && (
                                    <span className="text-[10px] text-red-500 font-bold">
                                        {errors.email}
                                    </span>
                                )}
                            </div>
                            <Input
                                type="email"
                                placeholder="brand@example.com"
                                value={formData.email}
                                onChange={(e) =>
                                    handleChange("email", e.target.value)
                                }
                                className={`bg-white border-gray-100 rounded-xl h-12 ${errors.email ? "border-red-200" : "focus:border-primary"}`}
                            />
                        </Field>
                    </div>

                    <Field>
                        <div className="flex justify-between items-center mb-1.5">
                            <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                                Address Line 1 *
                            </FieldLabel>
                            {errors.address_line1 && (
                                <span className="text-[10px] text-red-500 font-bold">
                                    {errors.address_line1}
                                </span>
                            )}
                        </div>
                        <Textarea
                            placeholder="Street address, locality..."
                            value={formData.address_line1}
                            onChange={(e) =>
                                handleChange("address_line1", e.target.value)
                            }
                            className={`bg-white border-gray-100 rounded-xl ${errors.address_line1 ? "border-red-200" : "focus:border-primary"}`}
                        />
                    </Field>

                    <Field>
                        <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                            Address Line 2 (optional)
                        </FieldLabel>
                        <Textarea
                            placeholder="City, state, pincode..."
                            value={formData.address_line2}
                            onChange={(e) =>
                                handleChange("address_line2", e.target.value)
                            }
                            className="bg-white border-gray-100 rounded-xl focus:border-primary"
                        />
                    </Field>

                    <Field>
                        <FieldLabel className="text-xs font-bold uppercase tracking-widest text-gray-400">
                            GST Number (optional)
                        </FieldLabel>
                        <Input
                            placeholder="e.g. 32ABCDE1234F1Z5"
                            value={formData.gst}
                            onChange={(e) =>
                                handleChange("gst", e.target.value)
                            }
                            className="bg-white border-gray-100 rounded-xl h-12 focus:border-primary"
                        />
                    </Field>
                </FieldGroup>
            </div>

            {/* CTA */}
            <div className="flex gap-4 items-center mt-auto pb-10">
                <StockFlowButton
                    variant="outline"
                    text="Cancel"
                    onClick={() => router.back()}
                    className="flex-1 h-14 rounded-2xl border-gray-200 font-bold text-gray-500 active:scale-95 transition-all text-sm"
                />
                <StockFlowButton
                    variant="filled"
                    text={isSubmitting ? "Creating..." : "Create Brand"}
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="flex-2 h-14 rounded-2xl bg-primary shadow-lg shadow-primary/20 font-bold text-white active:scale-95 transition-all text-sm"
                />
            </div>

            {cropSrc && (
                <CropModal
                    src={cropSrc}
                    onConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                />
            )}
        </div>
    );
}
