"use client";

import { Suspense } from "react";
import AdminCustomerSelect from "@/components/pages/admin/AdminCustomerSelect";
import { PageLoading } from "@/components/ui/Loading";

export default function AdminNewOrderPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminCustomerSelect />
    </Suspense>
  );
}
