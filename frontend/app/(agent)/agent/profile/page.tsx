"use client";
import ProfilePage from "@/components/pages/profile/ProfilePage";
import { useBackButton } from "@/util/useBackButton";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export default function Profile() {
  const router = useRouter();

  useBackButton({
    onBack: useCallback(() => {
      router.push("/agent/");
    }, [router]),
  });

  return <ProfilePage />;
}
