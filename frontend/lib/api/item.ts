import type {
    CustomerRequirementResponse,
    FabricAllResponse,
    FabricQRResponse,
    FabricRequest,
    FabricResponse,
    FabricStockEntry,
    FabricVariant,
    OutstandingDemandRow,
    VariantAllResponse,
} from "@/types/item";
import { api } from "./axios";

export const fabricApi = {
    getAll(): Promise<FabricAllResponse> {
        return api.get<FabricAllResponse>("/api/items/").then((r) => r.data);
    },

    getArchived(): Promise<FabricAllResponse> {
        return api.get<FabricAllResponse>("/api/items/archived/").then((r) => r.data);
    },

    getOne(id: number): Promise<FabricResponse> {
        return api.get<FabricResponse>(`/api/items/${id}/`).then((r) => r.data);
    },

    getAllVariants(): Promise<VariantAllResponse> {
        return api.get<VariantAllResponse>("/api/items/variants/all/").then((r) => r.data);
    },

    /** Every fabric with per-colour metre stock, for the order wizard. */
    getStockList(): Promise<FabricStockEntry[]> {
        return api.get<FabricStockEntry[]>("/api/items/stock-list/").then((r) => r.data);
    },

    /**
     * Metres still wanted per variant versus cloth on hand. A row with
     * `is_backordered` is oversubscribed across all open orders.
     */
    getOutstandingDemand(variantId?: number): Promise<OutstandingDemandRow[]> {
        const params = variantId ? { variant: String(variantId) } : undefined;
        return api
            .get<OutstandingDemandRow[]>("/api/items/outstanding-demand/", { params })
            .then((r) => r.data);
    },

    /** Resolve a scanned roll QR into its fabric and the colour that was hit. */
    byQr(qrCode: string, agentId?: number): Promise<FabricQRResponse> {
        const params: Record<string, string> = { qr_code: qrCode };
        if (agentId) params.agent_id = String(agentId);
        return api.get<FabricQRResponse>("/api/items/by-qr/", { params }).then((r) => r.data);
    },

    /** Who is waiting for this fabric, and how many metres each still needs. */
    getCustomerRequirements(fabricId: number): Promise<CustomerRequirementResponse> {
        return api
            .get<CustomerRequirementResponse>("/api/items/customer-requirements/", {
                params: { fabric_id: fabricId },
            })
            .then((r) => r.data);
    },

    create(data: FabricRequest | FormData): Promise<FabricResponse> {
        // For FormData, leave Content-Type unset so the browser adds the
        // multipart boundary itself (axios's transform would otherwise have no
        // header to fill in, and a manually-set header would drop the boundary).
        const headers = data instanceof FormData ? {} : { "Content-Type": "application/json" };
        return api.post<FabricResponse>("/api/items/", data, { headers }).then((r) => r.data);
    },

    update(id: number, data: FabricRequest | FormData): Promise<FabricResponse> {
        const headers = data instanceof FormData ? {} : { "Content-Type": "application/json" };
        return api.put<FabricResponse>(`/api/items/${id}/`, data, { headers }).then((r) => r.data);
    },

    /** Soft delete. Order history keeps referencing the fabric. */
    remove(id: number, pin: string): Promise<void> {
        return api.delete(`/api/items/${id}/`, { data: { pin } }).then((r) => r.data);
    },

    /** Set a variant's on-hand metres without touching the rest of the roll. */
    setVariantStock(variantId: number, stockMeters: string): Promise<FabricVariant> {
        return api
            .patch<FabricVariant>(`/api/items/variants/${variantId}/`, { stock_meters: stockMeters })
            .then((r) => r.data);
    },
};

/** Kept as an alias so existing import sites keep working. */
export const itemApi = fabricApi;
