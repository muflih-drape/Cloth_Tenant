"use client";

import { createContext, useContext, useEffect, ReactNode } from "react";

import { itemApi } from "@/lib/api/item";

import { setSizeRanges } from "@/types/item";

const SizeRangeContext = createContext({});

export function SizeRangeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const fetchSizeRanges = async () => {
      try {
        const data = await itemApi.getSizeRanges();
        setSizeRanges(data);
      } catch (error) {
        console.error("Failed to fetch size ranges", error);
      }
    };

    fetchSizeRanges();
  }, []);

  return (
    <SizeRangeContext.Provider value={{}}>{children}</SizeRangeContext.Provider>
  );
}

export function useSizeRanges() {
  return useContext(SizeRangeContext);
}
