"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { customerApi } from "@/lib/api/customer";
import { agentApi } from "@/lib/api/agents";
import { orderApi } from "@/lib/api/order";
import { toastSuccess, toastError } from "@/lib/toast";
import { CustomerResponse, CustomerUpdateRequest } from "@/types/customer";
import type { OrderResponse } from "@/types/order";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import StockFlowButton from "@/components/ui/custom/stockFlowButton";
import StockFlowSelect from "@/components/ui/custom/stockFlowSelect";
import { Trash2, ArrowLeft, User, Pencil, Eye, Package } from "lucide-react";
import Pagination from "@/components/ui/Pagination";
import DeleteWithTransferDialog from "@/components/ui/deleteWithTransferDialog";
import { PageLoading } from "@/components/ui/Loading";

function getColorFromId(id: number): string {
    if (!id) return "hsl(0, 0%, 85%)";
    const hue = (id * 137.508) % 360;
    return `hsl(${hue}, 65%, 85%)`;
}

export default function CustomerDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const [customer, setCustomer] = useState<CustomerResponse | null>(null);
    const [agents, setAgents] = useState<{ value: string; label: string }[]>(
        [],
    );
    const [orders, setOrders] = useState<OrderResponse[]>([]);
    const [formData, setFormData] = useState({
        name: "",
        address: "",
        contact: "",
        agent: "",
        gst: "",
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isEditing, setIsEditing] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize] = useState(50);
    const [totalOrders, setTotalOrders] = useState(0);
    const [totalPages, setTotalPages] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const numericId = parseInt(id as string, 10);
                const [customerData, agentsData, ordersData] =
                    await Promise.all([
                        customerApi.getOne(numericId),
                        agentApi.getAll(),
                        orderApi.getByCustomer(numericId, {
                            page: currentPage,
                            page_size: pageSize,
                        }),
                    ]);
                const filteredOrders = ordersData.results.filter(
                    (eachOrder) => eachOrder.status != "DRAFT",
                );
                setCustomer(customerData);
                setOrders(filteredOrders);
                setTotalOrders(ordersData.count);
                setTotalPages(Math.ceil(ordersData.count / pageSize));
                setFormData({
                    name: customerData.name,
                    address: customerData.address,
                    contact: customerData.contact,
                    agent: customerData.agent.toString(),
                    gst: customerData.gst,
                });
                setAgents(
                    agentsData.map((a) => ({
                        value: a.id.toString(),
                        label: a.user.username,
                    })),
                );
            } catch (error) {
                console.error("Error fetching customer:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id, currentPage, pageSize]);

    const handleChange = (key: string, value: string) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
    };

    const validate = () => {
        const newErrors: Record<string, string> = {};
        if (!formData.name.trim()) newErrors.name = "Name is required";
        if (!formData.address.trim()) newErrors.address = "Address is required";
        if (!formData.contact.trim()) newErrors.contact = "Contact is required";
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

    const handleUpdate = async () => {
        if (!validate()) return;
        setSaving(true);
        try {
            const numericId = parseInt(id as string, 10);
            const payload: CustomerUpdateRequest = {
                name: formData.name,
                address: formData.address,
                contact: formData.contact,
                agent: parseInt(formData.agent),
                gst: formData.gst.toUpperCase(),
            };
            await customerApi.update(numericId, payload);
            toastSuccess("Customer updated successfully");
            setIsEditing(false);
            router.refresh();
        } catch (error: any) {
            console.error("Error updating customer:", error);
            toastError("Failed to update customer", error);
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
            await customerApi.delete(_id, payload.pin, payload.action);
            toastSuccess("Customer deactivated successfully");
            router.push("/agent/customers/");
        } catch (error) {
            throw error;
        }
    };

    // customer page runs inside agent context; Admins use pin, agents cannot delete
    const handleDeleteClick = () => {
        setDeleteDialogOpen(true);
    };

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handlePageSizeChange = (size: number) => {
        void size;
        setCurrentPage(1);
    };

    if (loading) return <PageLoading />;
    if (!customer)
        return (
            <div className="p-8 text-center text-red-400">
                Customer not found.
            </div>
        );

    return (
        <div className="w-full px-4 py-8 flex flex-col min-h-screen bg-white">
            <DeleteWithTransferDialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                entityType="customer"
                entityId={parseInt(id as string, 10)}
                entityName={customer?.name || ""}
                onFetchDeleteInfo={customerApi.getDeleteInfo}
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
                        Customer Profile
                    </h1>
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em]">
                        Manage client records
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

            {/* Avatar Section */}
            <div className="flex flex-col items-center mb-6">
                <div
                    className="w-20 h-20 rounded-3xl flex items-center justify-center mb-4 shadow-sm"
                    style={{
                        backgroundColor: isEditing
                            ? "hsl(150, 65%, 92%)"
                            : getColorFromId(customer.id),
                    }}
                >
                    <User
                        size={40}
                        className={isEditing ? "text-primary" : "text-gray-600"}
                    />
                </div>
                <h2 className="text-2xl font-black text-gray-900">
                    {customer.name}
                </h2>
                <span className="text-xs font-bold text-gray-400 mt-1">
                    ID: #{id}
                </span>
            </div>

            {/* User Details Section */}
            {isEditing ? (
                <>
                    <div className="bg-gray-50/50 border border-gray-100 rounded-[2rem] p-6 space-y-6 mb-6">
                        <FieldGroup className="space-y-6">
                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Customer name
                                </FieldLabel>
                                <Input
                                    value={formData.name}
                                    onChange={(e) =>
                                        handleChange("name", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                                {errors.name && (
                                    <p className="text-[10px] text-red-500 font-bold mt-1">
                                        {errors.name}
                                    </p>
                                )}
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Assigned Agent
                                </FieldLabel>
                                <StockFlowSelect
                                    value={formData.agent}
                                    onChange={(val) =>
                                        handleChange("agent", val)
                                    }
                                    options={agents}
                                    className="bg-white"
                                />
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Shipping Address
                                </FieldLabel>
                                <Textarea
                                    rows={3}
                                    value={formData.address}
                                    onChange={(e) =>
                                        handleChange("address", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl font-bold"
                                />
                                {errors.address && (
                                    <p className="text-[10px] text-red-500 font-bold mt-1">
                                        {errors.address}
                                    </p>
                                )}
                            </Field>

                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    Contact detail
                                </FieldLabel>
                                <Input
                                    value={formData.contact}
                                    onChange={(e) =>
                                        handleChange("contact", e.target.value)
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                                {errors.contact && (
                                    <p className="text-[10px] text-red-500 font-bold mt-1">
                                        {errors.contact}
                                    </p>
                                )}
                            </Field>
                            <Field>
                                <FieldLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2 block">
                                    GST Number
                                </FieldLabel>
                                <Input
                                    value={formData.gst}
                                    onChange={(e) =>
                                        handleChange(
                                            "gst",
                                            e.target.value.toUpperCase(),
                                        )
                                    }
                                    className="bg-white border-gray-100 rounded-xl h-12 font-bold"
                                />
                                {errors.gst && (
                                    <p className="text-[10px] text-red-500 font-bold mt-1">
                                        {errors.gst}
                                    </p>
                                )}
                            </Field>
                        </FieldGroup>
                    </div>

                    <div className="mb-20 px-4">
                        <StockFlowButton
                            variant="filled"
                            text={saving ? "Saving Changes..." : "Save Changes"}
                            onClick={handleUpdate}
                            disabled={saving}
                            className="w-full h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20 flex items-center justify-center gap-2 active:scale-95 transition-all"
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
                                    Contact
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {customer.contact || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Address
                                </span>
                                <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">
                                    {customer.address || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    Agent
                                </span>
                                <span className="text-sm font-medium text-gray-900">
                                    {customer.agent_name || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-gray-400 uppercase">
                                    GST
                                </span>
                                <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">
                                    {customer.gst || "—"}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Order History Section */}
                    <div className="mt-6">
                        <div className="flex items-center gap-2 mb-3">
                            <Package size={16} className="text-gray-400" />
                            <span className="text-xs font-black uppercase tracking-widest text-gray-400">
                                Order History
                            </span>
                        </div>
                        {orders.length === 0 ? (
                            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-center">
                                <span className="text-sm font-medium text-gray-400">
                                    No orders yet
                                </span>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {orders.map((order) => (
                                    <button
                                        key={order.id}
                                        onClick={() =>
                                            router.push(
                                                `/agent/order/status/${order.id}`,
                                            )
                                        }
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 flex items-center justify-between hover:bg-gray-100 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div
                                                className={`w-2 h-2 rounded-full ${
                                                    order.status ===
                                                    "DISPATCHED"
                                                        ? "bg-green-500"
                                                        : order.status ===
                                                            "PACKED"
                                                          ? "bg-blue-500"
                                                          : order.status ===
                                                              "PENDING"
                                                            ? "bg-yellow-500"
                                                            : "bg-gray-300"
                                                }`}
                                            />
                                            <div>
                                                <span className="text-sm font-bold text-gray-900">
                                                    Order #{order.id}
                                                </span>
                                                <span className="text-xs text-gray-400 ml-2">
                                                    {order.total_sets} sets
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span
                                                className={`text-xs font-bold px-2 py-1 rounded-full ${
                                                    order.status ===
                                                    "DISPATCHED"
                                                        ? "bg-green-100 text-green-700"
                                                        : order.status ===
                                                            "PACKED"
                                                          ? "bg-blue-100 text-blue-700"
                                                          : order.status ===
                                                              "PENDING"
                                                            ? "bg-yellow-100 text-yellow-700"
                                                            : "bg-gray-100 text-gray-600"
                                                }`}
                                            >
                                                {order.status}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        totalCount={totalOrders}
                        pageSize={pageSize}
                        onPageChange={handlePageChange}
                        onPageSizeChange={handlePageSizeChange}
                    />
                </>
            )}

            <div className="h-20"></div>
        </div>
    );
}
