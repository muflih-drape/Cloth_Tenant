"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi } from "@/lib/api/admin";
import { brandApi } from "@/lib/api/brand";
import { toastSuccess, toastError } from "@/lib/toast";
import { AdminResponse } from "@/types/admin";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import {
    Trash2,
    ArrowLeft,
    ShieldAlert,
    Pencil,
    Eye,
    KeyRound,
    EyeOff,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { deriveUsername } from "@/lib/utils/deriveUsername";
import type { Brand } from "@/types/brand";
import { PageLoading } from "@/components/ui/Loading";

function getColorFromId(id: number): string {
    if (!id) return "hsl(0, 0%, 85%)";
    const hue = (id * 137.508) % 360;
    return `hsl(${hue}, 65%, 85%)`;
}

export default function AdminDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { isSuperuser } = useAuth();
    const [admin, setAdmin] = useState<AdminResponse | null>(null);
    const [brands, setBrands] = useState<Brand[]>([]);
    const [formData, setFormData] = useState({
        username: "",
        display_name: "",
        email: "",
        brand_id: "",
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isEditing, setIsEditing] = useState(false);

    // ── PIN change state ──────────────────────────────────────────────────────
    const [showPinSection, setShowPinSection] = useState(false);
    const [pinData, setPinData] = useState({ pin: "", confirmPin: "" });
    const [showPin, setShowPin] = useState(false);
    const [showConfirmPin, setShowConfirmPin] = useState(false);
    const [pinErrors, setPinErrors] = useState<Record<string, string>>({});
    const [savingPin, setSavingPin] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const numericId = parseInt(id as string, 10);
                const data = await adminApi.getOne(numericId);
                setAdmin(data);
                setFormData({
                    username: data.username,
                    display_name: data.display_name || "",
                    email: data.email,
                    brand_id: data.brand_id ? String(data.brand_id) : "",
                });
            } catch (error) {
                console.error("Error fetching admin:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id]);

    useEffect(() => {
        if (isSuperuser) {
            brandApi
                .getAll()
                .then(setBrands)
                .catch(() => setBrands([]));
        }
    }, [isSuperuser]);

    const handleChange = (key: string, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
    };

    const handleUpdate = async () => {
        setSaving(true);
        try {
            const numericId = parseInt(id as string, 10);
            const username = deriveUsername(
                formData.display_name || formData.username,
            );
            await adminApi.update(numericId, {
                username,
                display_name: formData.display_name,
                email: formData.email,
                brand_id: formData.brand_id
                    ? parseInt(formData.brand_id)
                    : undefined,
            });
            toastSuccess("Admin updated successfully");
            setIsEditing(false);
            router.push("/admin/users/");
        } catch (error: any) {
            console.error("Error updating admin:", error);
            toastError("Failed to update admin", error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (
            confirm(
                "Are you sure you want to delete this administrator? This action is irreversible.",
            )
        ) {
            setDeleting(true);
            try {
                const numericId = parseInt(id as string, 10);
                await adminApi.delete(numericId);
                toastSuccess("Admin deleted successfully");
                router.push("/admin/users/");
            } catch (error) {
                console.error("Error deleting admin:", error);
                toastError("Failed to delete admin", error);
                setDeleting(false);
            }
        }
    };

    // ── PIN handlers ──────────────────────────────────────────────────────────

    const handlePinChange = (key: string, value: string) => {
        const digit = value.replace(/\D/g, "").slice(0, 6);
        setPinData((prev) => ({ ...prev, [key]: digit }));
        if (pinErrors[key]) setPinErrors((prev) => ({ ...prev, [key]: "" }));
    };

    const validatePin = () => {
        const newErrors: Record<string, string> = {};
        if (!pinData.pin) {
            newErrors.pin = "PIN is required";
        } else if (pinData.pin.length !== 6) {
            newErrors.pin = "PIN must be exactly 6 digits";
        }
        if (!pinData.confirmPin) {
            newErrors.confirmPin = "Please confirm the PIN";
        } else if (pinData.pin !== pinData.confirmPin) {
            newErrors.confirmPin = "PINs do not match";
        }
        setPinErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSavePin = async () => {
        if (!validatePin()) return;
        setSavingPin(true);
        try {
            const numericId = parseInt(id as string, 10);
            await adminApi.update(numericId, {
                pin: pinData.pin,
                brand_id: formData.brand_id
                    ? parseInt(formData.brand_id)
                    : undefined,
            });
            toastSuccess("PIN updated successfully");
            setPinData({ pin: "", confirmPin: "" });
            setShowPinSection(false);
        } catch (error: any) {
            console.error("Error updating PIN:", error);
            toastError("Failed to update PIN", error);
        } finally {
            setSavingPin(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading) return <PageLoading />;
    if (!admin)
        return (
            <div className="p-8 text-center text-red-400">Admin not found.</div>
        );

    const getBrandName = () => {
        if (!admin.brand_id) return null;
        const brand = brands.find((b) => b.id === admin.brand_id);
        return brand?.name || `Brand #${admin.brand_id}`;
    };

    return (
        <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
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
                        Admin Profile
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
                        onClick={handleDelete}
                        disabled={deleting}
                        className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                    >
                        {deleting ? (
                            <span className="w-5 h-5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin block" />
                        ) : (
                            <Trash2 size={20} />
                        )}
                    </button>
                </div>
            </div>

            {/* Avatar Section */}
            <div className="flex flex-col items-center mb-6">
                <div
                    className="w-20 h-20 rounded-3xl flex items-center justify-center mb-4 shadow-sm"
                    style={{
                        backgroundColor: isEditing
                            ? "#fef3c7"
                            : getColorFromId(admin.id),
                    }}
                >
                    <ShieldAlert
                        size={40}
                        className={
                            isEditing ? "text-amber-500" : "text-gray-600"
                        }
                    />
                </div>
                <h2 className="text-2xl font-black text-gray-900">
                    {admin.display_name || admin.username}
                </h2>
                <span className="text-xs font-bold text-gray-400 mt-1 font-mono tracking-tighter">
                    ADMINISTRATOR
                </span>
            </div>

            {/* User Details Section */}
            {isEditing ? (
                <>
                    <div className="bg-gray-50/50 border border-gray-100 rounded-[2rem] p-6 space-y-6 mb-6">
                        <FieldGroup className="space-y-6">
                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Display Name
                                </FieldLabel>
                                <Input
                                    value={formData.display_name}
                                    onChange={(e) =>
                                        handleChange(
                                            "display_name",
                                            e.target.value,
                                        )
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                                {formData.display_name.trim() && (
                                    <p className="mt-1.5 text-[11px] text-gray-400">
                                        Username:{" "}
                                        <span className="font-mono font-medium text-gray-600">
                                            {deriveUsername(
                                                formData.display_name,
                                            )}
                                        </span>
                                    </p>
                                )}
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    System Username (auto-derived)
                                </FieldLabel>
                                <Input
                                    value={deriveUsername(
                                        formData.display_name ||
                                            formData.username,
                                    )}
                                    disabled
                                    className="bg-gray-50 border-gray-100 rounded-xl h-12 font-mono text-sm"
                                />
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Recovery Email
                                </FieldLabel>
                                <Input
                                    value={formData.email}
                                    onChange={(e) =>
                                        handleChange("email", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                            </Field>

                            {isSuperuser && (
                                <Field>
                                    <div className="flex justify-between items-center mb-1.5">
                                        <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                            Brand *
                                        </FieldLabel>
                                        {errors.brand_id && (
                                            <span className="text-[10px] text-red-500 font-bold">
                                                {errors.brand_id}
                                            </span>
                                        )}
                                    </div>
                                    <Select
                                        value={formData.brand_id}
                                        onValueChange={(v) =>
                                            handleChange("brand_id", v)
                                        }
                                    >
                                        <SelectTrigger className="bg-white h-12 focus:border-primary">
                                            <SelectValue placeholder="Select brand" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {brands.map((brand) => (
                                                <SelectItem
                                                    key={brand.id}
                                                    value={String(brand.id)}
                                                >
                                                    {brand.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                            )}
                        </FieldGroup>
                    </div>

                    <div className="mb-6 px-4">
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
                    {/* View Mode - Compact Details */}
                    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 mb-6 w-full">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Display Name
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {admin.display_name || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Username
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {admin.username}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Recovery Email
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {admin.email || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    {admin.business ? "Business" : "Admin Type"}
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {admin.business
                                        ? admin.business
                                        : "Super user"}
                                </span>
                            </div>
                            {getBrandName() && (
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-400 uppercase">
                                        Brand
                                    </span>
                                    <span className="text-sm font-medium text-gray-900">
                                        {getBrandName()}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* ── PIN Section (superuser only) ────────────────────────────────────── */}
            {isSuperuser && (
                <div className="mb-6">
                    {/* Toggle button */}
                    <button
                        onClick={() => {
                            setShowPinSection((v) => !v);
                            setPinData({ pin: "", confirmPin: "" });
                            setPinErrors({});
                        }}
                        className="w-full flex items-center justify-between px-5 py-4 bg-amber-50 border border-amber-200 rounded-2xl active:scale-[0.99] transition-all"
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
                                <KeyRound
                                    size={18}
                                    className="text-amber-600"
                                />
                            </div>
                            <div className="text-left">
                                <p className="text-sm font-black text-gray-900">
                                    Change Delete PIN
                                </p>
                                <p className="text-[11px] text-gray-400">
                                    Update the 6-digit PIN for this admin
                                </p>
                            </div>
                        </div>
                        <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                showPinSection
                                    ? "border-amber-500 bg-amber-500"
                                    : "border-gray-300"
                            }`}
                        >
                            {showPinSection && (
                                <div className="w-2 h-2 rounded-full bg-white" />
                            )}
                        </div>
                    </button>

                    {/* PIN form */}
                    {showPinSection && (
                        <div className="mt-3 bg-gray-50/50 border border-gray-100 rounded-2xl p-5 space-y-4">
                            {/* New PIN */}
                            <Field>
                                <div className="flex justify-between items-center mb-1.5">
                                    <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                        New PIN
                                    </FieldLabel>
                                    {pinErrors.pin ? (
                                        <span className="text-[10px] text-red-500 font-bold">
                                            {pinErrors.pin}
                                        </span>
                                    ) : (
                                        <span className="text-[10px] text-gray-400">
                                            {pinData.pin.length}/6 digits
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <Input
                                        type={showPin ? "text" : "password"}
                                        inputMode="numeric"
                                        placeholder="6-digit PIN"
                                        value={pinData.pin}
                                        onChange={(e) =>
                                            handlePinChange(
                                                "pin",
                                                e.target.value,
                                            )
                                        }
                                        className={`bg-white border-gray-100 rounded-xl h-12 pr-12 tracking-[0.3em] font-mono ${
                                            pinErrors.pin
                                                ? "border-red-200"
                                                : "focus:border-primary"
                                        }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPin((v) => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                        {showPin ? (
                                            <EyeOff size={16} />
                                        ) : (
                                            <Eye size={16} />
                                        )}
                                    </button>
                                </div>

                                {/* PIN dot preview */}
                                {pinData.pin.length > 0 && (
                                    <div className="flex gap-2 mt-3">
                                        {Array.from({ length: 6 }).map(
                                            (_, i) => (
                                                <div
                                                    key={i}
                                                    className={`w-8 h-8 rounded-lg border-2 flex items-center justify-center transition-all ${
                                                        i < pinData.pin.length
                                                            ? "border-primary bg-primary/10"
                                                            : "border-gray-200 bg-gray-50"
                                                    }`}
                                                >
                                                    {showPin ? (
                                                        <span className="text-sm font-bold text-primary">
                                                            {pinData.pin[i] ??
                                                                ""}
                                                        </span>
                                                    ) : (
                                                        i <
                                                            pinData.pin
                                                                .length && (
                                                            <div className="w-2 h-2 rounded-full bg-primary" />
                                                        )
                                                    )}
                                                </div>
                                            ),
                                        )}
                                    </div>
                                )}
                            </Field>

                            {/* Confirm PIN */}
                            <Field>
                                <div className="flex justify-between items-center mb-1.5">
                                    <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                        Confirm PIN
                                    </FieldLabel>
                                    {pinErrors.confirmPin && (
                                        <span className="text-[10px] text-red-500 font-bold">
                                            {pinErrors.confirmPin}
                                        </span>
                                    )}
                                </div>
                                <div className="relative">
                                    <Input
                                        type={
                                            showConfirmPin ? "text" : "password"
                                        }
                                        inputMode="numeric"
                                        placeholder="Re-enter PIN"
                                        value={pinData.confirmPin}
                                        onChange={(e) =>
                                            handlePinChange(
                                                "confirmPin",
                                                e.target.value,
                                            )
                                        }
                                        className={`bg-white border-gray-100 rounded-xl h-12 pr-12 tracking-[0.3em] font-mono ${
                                            pinErrors.confirmPin
                                                ? "border-red-200"
                                                : pinData.confirmPin.length ===
                                                        6 &&
                                                    pinData.pin ===
                                                        pinData.confirmPin
                                                  ? "border-green-400"
                                                  : "focus:border-primary"
                                        }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowConfirmPin((v) => !v)
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                    >
                                        {showConfirmPin ? (
                                            <EyeOff size={16} />
                                        ) : (
                                            <Eye size={16} />
                                        )}
                                    </button>
                                </div>

                                {/* Match indicator */}
                                {pinData.confirmPin.length > 0 && (
                                    <p
                                        className={`text-[11px] font-bold mt-1.5 ${
                                            pinData.pin === pinData.confirmPin
                                                ? "text-green-500"
                                                : "text-red-400"
                                        }`}
                                    >
                                        {pinData.pin === pinData.confirmPin
                                            ? "✓ PINs match"
                                            : "✗ PINs do not match"}
                                    </p>
                                )}
                            </Field>

                            {/* Save PIN button */}
                            <StockFlowButton
                                variant="filled"
                                text={savingPin ? "Saving PIN..." : "Save PIN"}
                                onClick={handleSavePin}
                                disabled={
                                    savingPin ||
                                    pinData.pin.length !== 6 ||
                                    pinData.pin !== pinData.confirmPin
                                }
                                className="w-full h-12 rounded-xl bg-amber-500 text-white font-bold shadow-lg shadow-amber-500/20 active:scale-95 transition-all disabled:opacity-40"
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="h-20"></div>
        </div>
    );
}
