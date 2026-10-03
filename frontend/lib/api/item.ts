import type {
    BulkReceiveRollsResponse,
    CustomerRequirementResponse,
    FabricAllResponse,
    FabricQRResponse,
    FabricRequest,
    FabricResponse,
    FabricRoll,
    FabricStockEntry,
    FabricVariant,
    OutstandingDemandRow,
    ReceiveRollResponse,
    RollCutPlan,
    RollHistoryResponse,
    RollSummary,
    VariantAllResponse,
    VariantRollsResponse,
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

/**
 * Physical rolls.
 *
 * A colour tracked by rolls has its stock figure owned by these calls: receiving
 * a roll, correcting one, or packing against it is the only way the warehouse
 * total moves. The backend refuses a plain stock edit for such a colour, so the
 * UI never has to guess whether typing a number is safe.
 */
export const rollApi = {
    /** Every roll, optionally narrowed to one colour or to active rolls. */
    getAll(variantId?: number, activeOnly = false): Promise<FabricRoll[]> {
        const params: Record<string, string> = {};
        if (variantId) params.variant = String(variantId);
        if (activeOnly) params.active = "1";
        return api.get<FabricRoll[]>("/api/items/rolls/", { params }).then((r) => r.data);
    },

    /** One colour's rolls plus its roll totals, for the inventory panel. */
    getForVariant(variantId: number): Promise<VariantRollsResponse> {
        return api
            .get<VariantRollsResponse>(`/api/items/variants/${variantId}/rolls/`)
            .then((r) => r.data);
    },

    /** Receive one roll onto a colour. */
    receive(
        variantId: number,
        data: { meters: string; roll_number?: string; note?: string }
    ): Promise<ReceiveRollResponse> {
        return api
            .post<ReceiveRollResponse>(`/api/items/variants/${variantId}/rolls/`, data)
            .then((r) => r.data);
    },

    /** Receive a factory delivery as several rolls, all or nothing. */
    bulkReceive(
        variantId: number,
        rolls: { meters: string; note?: string }[]
    ): Promise<BulkReceiveRollsResponse> {
        return api
            .post<BulkReceiveRollsResponse>(`/api/items/variants/${variantId}/rolls/bulk-add/`, {
                rolls,
            })
            .then((r) => r.data);
    },

    /** Correct a roll's metres. Negative takes cloth off, positive adds it. */
    adjust(rollId: number, meters: string, reason?: string): Promise<FabricRoll> {
        return api
            .post<FabricRoll>(`/api/items/rolls/${rollId}/adjust/`, {
                meters,
                reason,
            })
            .then((r) => r.data);
    },

    /** What was cut from a roll, and what was handed back. */
    history(rollId: number): Promise<RollHistoryResponse> {
        return api.get<RollHistoryResponse>(`/api/items/rolls/${rollId}/history/`).then((r) => r.data);
    },

    /** Which rolls packing this many metres would come off, by best fit. */
    preview(variantId: number, meters: string): Promise<RollCutPlan> {
        return api
            .post<RollCutPlan>(`/api/items/variants/${variantId}/rolls/preview/`, { meters })
            .then((r) => r.data);
    },

    /** Delete a roll that holds nothing and has never been cut from. */
    remove(rollId: number): Promise<void> {
        return api.delete(`/api/items/rolls/${rollId}/`).then((r) => r.data);
    },

    /** Put a colour's total back in step with its rolls after a manual edit. */
    syncStock(variantId: number): Promise<{ stock_meters: string } & RollSummary> {
        return api
            .post<{ stock_meters: string } & RollSummary>(
                `/api/items/variants/${variantId}/rolls/sync-stock/`
            )
            .then((r) => r.data);
    },
};

/** Kept as an alias so existing import sites keep working. */
export const itemApi = fabricApi;
