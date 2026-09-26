"use client";

import { useParams, useRouter } from "next/navigation";
import PackingBoard from "@/components/pages/admin/packing/PackingBoard";

export default function PackingBoardPage() {
  const params = useParams();
  const router = useRouter();
  const variantId = Number(params.variant);

  if (!variantId) return null;

  return (
    <PackingBoard variantId={variantId} onDone={() => router.push("/admin/packing")} />
  );
}
