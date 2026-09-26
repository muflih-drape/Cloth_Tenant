"use client";

import { Pencil } from "lucide-react";

interface EditModeBannerProps {
  isEditing: boolean;
  entityName?: string;
}

export default function EditModeBanner({
  isEditing,
  entityName = "record",
}: EditModeBannerProps) {
  if (!isEditing) return null;

  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-2.5 mb-5">
      <Pencil size={13} className="text-amber-500 flex-shrink-0" />
      <p className="text-[11px] font-bold text-amber-700">
        Editing {entityName} — tap the eye icon to discard and return to view
        mode
      </p>
    </div>
  );
}
