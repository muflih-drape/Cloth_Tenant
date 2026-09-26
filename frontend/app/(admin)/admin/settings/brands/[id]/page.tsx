"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import heic2any from "heic2any";

import { brandApi } from "@/lib/api/brand";
import { toastSuccess, toastError } from "@/lib/toast";
import { BrandResponse } from "@/types/brand";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import { Trash2, ArrowLeft, Store, Pencil, Eye, X, Camera } from "lucide-react";
import CropModal from "@/app/(admin)/admin/items/new/cropModal";
import DeleteWithTransferDialog from "@/components/ui/deleteWithTransferDialog";
import { normalizeImageFile } from "@/lib/image-utils";
import { PageLoading } from "@/components/ui/Loading";

export default function BrandDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [brand, setBrand] = useState<BrandResponse | null>(null);
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
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isEditing, setIsEditing] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const numericId = parseInt(id as string, 10);
                const data = await brandApi.getOne(numericId);
                setBrand(data);
                setFormData({
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    address_line1: data.address_line1,
                    address_line2: data.address_line2 || "",
                    gst: data.gst || "",
                });
                if (data.logo_url) {
                    setLogoPreview(data.logo_url);
                }
            } catch (error) {
                console.error("Error fetching brand:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    const handleChange = (key: string, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
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
        if (logoPreview && !logoPreview.startsWith("http")) {
            URL.revokeObjectURL(logoPreview);
        }
        setLogoPreview(null);
    };

    const handleUpdate = async () => {
        setSaving(true);
        try {
            const numericId = parseInt(id as string, 10);
            await brandApi.update(numericId, {
                ...formData,
                logo: logoFile || undefined,
            });
            toastSuccess("Brand updated successfully");
            setIsEditing(false);
            setLogoFile(null);
            router.refresh();
        } catch (error: any) {
            console.error("Error updating brand:", error);
            toastError("Failed to update brand", error);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteConfirm = async (
        _id: number,
        payload: {
            pin: string;
            action: "transfer" | "deactivate";
            transfer_to_id?: number;
        },
    ) => {
        try {
            await brandApi.delete(
                _id,
                payload.pin,
                payload.action,
                payload.transfer_to_id,
            );
            toastSuccess("Brand deleted successfully");
            router.push("/admin/brands/");
        } catch (error) {
            throw error;
        }
    };

    const handleDeleteClick = () => {
        setDeleteDialogOpen(true);
    };

    if (loading) return <PageLoading />;
    if (!brand)
        return (
            <div className="p-8 text-center text-red-400">Brand not found.</div>
        );

    return (
        <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
            <DeleteWithTransferDialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                entityType="brand"
                entityId={parseInt(id as string, 10)}
                entityName={brand?.name || ""}
                onFetchDeleteInfo={brandApi.getDeleteInfo}
                onDelete={handleDeleteConfirm}
            />
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <button
                    onClick={() => router.back()}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-50 transition-colors"
                >
                    <ArrowLeft size={24} className="text-gray-900" />
                </button>
                <div className="text-center flex-1">
                    <h1 className="text-xl font-black text-gray-900 tracking-tight">
                        Brand Profile
                    </h1>
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em]">
                        Master Control
                    </p>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="p-2 rounded-xl hover:bg-gray-50 transition-colors"
                        title={isEditing ? "View details" : "Edit details"}
                    >
                        {isEditing ? (
                            <Eye size={20} className="text-gray-700" />
                        ) : (
                            <Pencil size={20} className="text-gray-700" />
                        )}
                    </button>
                    <button
                        onClick={handleDeleteClick}
                        className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>

            {/* Logo Section */}
            <div className="flex flex-col items-center mb-6">
                <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-4 shadow-sm bg-primary/10 overflow-hidden relative">
                    {logoPreview ? (
                        <img
                            src={logoPreview}
                            alt={brand.name}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Store size={40} className="text-primary" />
                    )}
                    {isEditing && (
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                        >
                            <Camera size={24} className="text-white" />
                        </button>
                    )}
                    {logoPreview && isEditing && (
                        <button
                            type="button"
                            onClick={removeLogo}
                            className="absolute top-1 right-1 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                        >
                            <X size={12} />
                        </button>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleImageSelect}
                    />
                </div>
                <h2 className="text-2xl font-black text-gray-900">
                    {brand.name}
                </h2>
                <span className="text-xs font-bold text-gray-400 mt-1 font-mono tracking-tighter">
                    BRAND
                </span>
            </div>

            {/* Details */}
            {isEditing ? (
                <>
                    <div className="bg-gray-50/50 border border-gray-100 rounded-[2rem] p-6 space-y-6 mb-6">
                        <FieldGroup className="space-y-6">
                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Brand Name *
                                </FieldLabel>
                                {errors.name && (
                                    <span className="text-[10px] text-red-500 font-bold">
                                        {errors.name}
                                    </span>
                                )}
                                <Input
                                    value={formData.name}
                                    onChange={(e) =>
                                        handleChange("name", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                            </Field>

                            <div className="grid grid-cols-2 gap-4">
                                <Field>
                                    <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                        Phone *
                                    </FieldLabel>
                                    {errors.phone && (
                                        <span className="text-[10px] text-red-500 font-bold">
                                            {errors.phone}
                                        </span>
                                    )}
                                    <Input
                                        value={formData.phone}
                                        onChange={(e) =>
                                            handleChange(
                                                "phone",
                                                e.target.value,
                                            )
                                        }
                                        className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                    />
                                </Field>

                                <Field>
                                    <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                        Email *
                                    </FieldLabel>
                                    {errors.email && (
                                        <span className="text-[10px] text-red-500 font-bold">
                                            {errors.email}
                                        </span>
                                    )}
                                    <Input
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) =>
                                            handleChange(
                                                "email",
                                                e.target.value,
                                            )
                                        }
                                        className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                    />
                                </Field>
                            </div>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Address Line 1 *
                                </FieldLabel>
                                {errors.address_line1 && (
                                    <span className="text-[10px] text-red-500 font-bold">
                                        {errors.address_line1}
                                    </span>
                                )}
                                <Textarea
                                    value={formData.address_line1}
                                    onChange={(e) =>
                                        handleChange(
                                            "address_line1",
                                            e.target.value,
                                        )
                                    }
                                    className="bg-white border-gray-100 rounded-xl font-bold"
                                />
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Address Line 2 (optional)
                                </FieldLabel>
                                <Textarea
                                    value={formData.address_line2}
                                    onChange={(e) =>
                                        handleChange(
                                            "address_line2",
                                            e.target.value,
                                        )
                                    }
                                    className="bg-white border-gray-100 rounded-xl font-bold"
                                />
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    GST Number (optional)
                                </FieldLabel>
                                <Input
                                    value={formData.gst}
                                    onChange={(e) =>
                                        handleChange("gst", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                            </Field>
                        </FieldGroup>
                    </div>

                    <div className="mb-20 px-4">
                        <StockFlowButton
                            variant="filled"
                            text={saving ? "Processing..." : "Commit Update"}
                            onClick={handleUpdate}
                            disabled={saving}
                            className="w-full h-14 rounded-2xl bg-black text-white font-bold shadow-lg shadow-black/10 flex items-center justify-center gap-2 active:scale-95 transition-all text-sm uppercase tracking-widest"
                        />
                    </div>
                </>
            ) : (
                <>
                    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-6 w-full">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Phone
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {brand.phone}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Email
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {brand.email}
                                </span>
                            </div>
                            <div className="flex justify-between items-start">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Address
                                </span>
                                <span className="text-sm font-medium text-gray-900 text-right">
                                    {brand.address_line1}
                                    {brand.address_line2 && (
                                        <>
                                            {`\n`}
                                            {brand.address_line2}
                                        </>
                                    )}
                                </span>
                            </div>
                            {brand.gst && (
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase">
                                        GST
                                    </span>
                                    <span className="text-sm font-medium text-gray-900">
                                        {brand.gst}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            <div className="h-20"></div>

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
