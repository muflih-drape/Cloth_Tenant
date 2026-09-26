import type { Role } from "./auth";

export interface AgentUser {
    id: number;
    username: string;
    email: string;
    role?: Role;
    display_name?: string;
}

export interface VariantSize {
    id: number;
    size: string;
    stock: number;
}

export interface AssignedVariantSize {
    id: number;
    size_range: string;
    stock: number;
}

export interface AgentItemVariant {
    id: number;
    image: string | null;
    qr_code: string | null;
    size_ranges: AssignedVariantSize[];
    created_at: string;
}

export interface AssignedItem {
    id: number;
    name: string;
    type: string;
    price: string;
    variants: AgentItemVariant[];
}

export interface Agent {
    id: number;
    user: AgentUser;
    contact: string;
    total_customers: string;
    assigned_items?: AssignedItem[];
}

export interface AgentRequest {
    username: string;
    email: string;
    password: string;
    display_name?: string;
    contact: string;
}

export interface AgentUpdateRequest {
    username?: string;
    email?: string;
    password?: string;
    display_name?: string;
    contact?: string;
}

export type AgentAllResponse = Agent[];
export type AgentResponse = Agent;

export interface AgentDeleteInfo {
    customers_count: number;
    orders_count: number;
    transferable_agents: { id: number; name: string }[];
}
