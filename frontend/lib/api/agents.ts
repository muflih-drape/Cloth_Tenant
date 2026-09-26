import type {
  AgentAllResponse,
  AgentResponse,
  AgentRequest,
  AgentUpdateRequest,
  AgentDeleteInfo,
  AssignedItem,
} from "@/types/agent";
import { api } from "./axios";

export const agentApi = {
  getAll(): Promise<AgentAllResponse> {
    return api.get<AgentAllResponse>("/api/agents/").then((r) => r.data);
  },

  getProfile(userId: number): Promise<AgentResponse> {
    return api
      .get<AgentResponse>(`/api/agents/profile/${userId}/`)
      .then((r) => r.data);
  },

  getOne(id: number): Promise<AgentResponse> {
    return api.get<AgentResponse>(`/api/agents/${id}/`).then((r) => r.data);
  },

  create(data: AgentRequest): Promise<AgentResponse> {
    return api.post<AgentResponse>("/api/agents/", data).then((r) => r.data);
  },

  update(id: number, data: AgentUpdateRequest): Promise<AgentResponse> {
    return api
      .patch<AgentResponse>(`/api/agents/${id}/`, data)
      .then((r) => r.data);
  },

  getDeleteInfo(id: number): Promise<AgentDeleteInfo> {
    return api.get<AgentDeleteInfo>(`/api/agents/${id}/delete_info/`).then((r) => r.data);
  },

  delete(id: number, pin: string, action?: string, transfer_to_id?: number): Promise<void> {
    return api
      .delete(`/api/agents/${id}/`, { data: { pin, action, transfer_to_id } })
      .then((r) => r.data);
  },

  getItems(agentId: number): Promise<AssignedItem[]> {
    return api
      .get<AssignedItem[]>(`/api/agents/${agentId}/items/`)
      .then((r) => r.data);
  },

  updateItems(agentId: number, variantIds: number[]): Promise<AssignedItem[]> {
    return api
      .post<AssignedItem[]>(`/api/agents/${agentId}/items/`, {
        variant_ids: variantIds,
      })
      .then((r) => r.data);
  },

  deleteAllItems(agentId: number): Promise<void> {
    return api.delete(`/api/agents/${agentId}/items/`).then((r) => r.data);
  },

  removeItem(agentId: number, variantId: number): Promise<void> {
    return api
      .delete(`/api/agents/${agentId}/items/variants/${variantId}/`)
      .then((r) => r.data);
  },

  transferItems(agentId: number, targetAgentId: number): Promise<void> {
    return api
      .post(`/api/agents/${agentId}/items/transfer/`, {
        target_agent_id: targetAgentId,
      })
      .then((r) => r.data);
  },

  copyItems(agentId: number, targetAgentId: number): Promise<void> {
    return api
      .post(`/api/agents/${agentId}/items/copy/`, {
        target_agent_id: targetAgentId,
      })
      .then((r) => r.data);
  },
};
