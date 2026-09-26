import React from "react";
import { CheckCircle, X } from "lucide-react";

interface SuccessAlertProps {
  title: string;
  description?: string;
  onClose?: () => void;
}

export const SuccessAlert: React.FC<SuccessAlertProps> = ({
  title,
  description,
  onClose,
}) => {
  return (
    <div className="relative flex items-start gap-3 p-4 rounded-xl border border-green-200 bg-green-50 text-(--color-primary) shadow-md max-w-md">
      <CheckCircle className="w-6 h-6 mt-1 text-(--color-primary)" />

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
