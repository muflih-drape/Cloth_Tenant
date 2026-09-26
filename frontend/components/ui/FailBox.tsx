import React from "react";
import { XCircle, X } from "lucide-react";

interface FailedBoxProps {
  title: string;
  description?: string;
  onClose?: () => void;
}

export const FailedBox: React.FC<FailedBoxProps> = ({
  title,
  description,
  onClose,
}) => {
  return (
    <div className="relative flex items-start gap-3 p-4 rounded-xl border border-red-200 bg-red-50 text-(--color-primary) shadow-md max-w-md">
      <XCircle className="w-6 h-6 mt-1 text-(--color-primary)" />

      <div className="flex-1">
        <h3 className="font-semibold text-base text-(--color-primary)">
          {title}
        </h3>

        {description && (
          <p className="text-sm text-black mt-1">{description}</p>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-(--color-primary)"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
