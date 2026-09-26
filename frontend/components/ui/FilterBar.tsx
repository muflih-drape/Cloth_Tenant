"use client";
import DatePicker from "./date-picker";
import StockFlowSelect from "./custom/stockFlowSelect";
import AsyncSelect from "react-select/async";
import { customerApi } from "@/lib/api/customer";

interface Tab {
  value: string;
  label: string;
}

interface FilterBarProps {
  fromDate: string;
  toDate: string;
  onFromDateChange: (date: string) => void;
  onToDateChange: (date: string) => void;
  agents?: { id: number; username: string }[];
  selectedAgent?: string;
  onAgentChange?: (agentId: string) => void;
  // removed: customers prop
  selectedCustomer?: string;
  onCustomerChange?: (customerId: string) => void;
  isOpen: boolean;
  onClear: () => void;
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (val: string) => void;
}

export default function FilterBar({
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  agents = [],
  selectedAgent = "",
  onAgentChange,
  selectedCustomer = "",
  onCustomerChange,
  isOpen,
  onClear,
  tabs = [],
  activeTab,
  onTabChange,
}: FilterBarProps) {
  if (!isOpen) return null;

  const hasFilters =
    fromDate ||
    toDate ||
    (selectedAgent && selectedAgent !== "all") ||
    (selectedCustomer && selectedCustomer !== "all");

  const loadCustomers = async (inputValue: string) => {
    const response = await customerApi.getAll({
      search: inputValue,
      page: 1,
      page_size: 20,
    });
    return [
      { value: "all", label: "All Customers" },
      ...response.results.map((c) => ({
        value: String(c.id),
        label: c.name,
      })),
    ];
  };

  return (
    <div className="relative flex flex-wrap gap-2 items-center p-2 bg-gray-50 rounded-lg">
      <div className="relative flex-1 min-w-[140px]">
        <DatePicker
          value={fromDate}
          onChange={onFromDateChange}
          placeholder="From date"
        />
      </div>
      <span className="text-gray-400 text-xs">to</span>
      <div className="relative flex-1 min-w-[140px]">
        <DatePicker
          value={toDate}
          onChange={onToDateChange}
          placeholder="To date"
        />
      </div>

      {agents.length > 0 && onAgentChange && (
        <>
          <span className="text-gray-400 text-xs">Agent</span>
          <div className="flex-1 min-w-[140px]">
            <StockFlowSelect
              value={selectedAgent}
              onChange={onAgentChange}
              placeholder="All Agents"
              options={[
                { value: "all", label: "All Agents" },
                ...agents.map((a) => ({
                  value: String(a.id),
                  label: a.username,
                })),
              ]}
            />
          </div>
        </>
      )}

      {onCustomerChange && (
        <>
          <span className="text-gray-400 text-xs">Customer</span>
          <div className="flex-1 min-w-[140px]">
            <AsyncSelect
              isClearable
              defaultOptions
              loadOptions={loadCustomers}
              value={
                selectedCustomer && selectedCustomer !== "all"
                  ? { value: selectedCustomer, label: selectedCustomer }
                  : null
              }
              onChange={(option) => onCustomerChange(option?.value ?? "all")}
              placeholder="All Customers"
              classNames={{
                control: () =>
                  "!border-gray-200 !rounded-xl !text-sm !min-h-[38px] !shadow-none",
                option: () => "!text-sm",
              }}
            />
          </div>
        </>
      )}

      {tabs.length > 0 && onTabChange && (
        <div className="flex gap-2 items-center w-full">
          <span className="text-gray-400 text-xs">Item type</span>
          <div className="flex-1 min-w-[140px]">
            <StockFlowSelect
              value={activeTab!}
              onChange={onTabChange}
              placeholder="All"
              options={tabs.map((c) => ({
                value: String(c.value),
                label: String(c.label),
              }))}
            />
          </div>
        </div>
      )}

      {hasFilters && (
        <button
          onClick={onClear}
          className="text-xs text-red-500 hover:text-red-600 font-medium px-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}
