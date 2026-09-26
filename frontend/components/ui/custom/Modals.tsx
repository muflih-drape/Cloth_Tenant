import { X } from "lucide-react";

export function Modal({
  icon,
  iconBg,
  title,
  description,
  onClose,
  actions,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  onClose: () => void;
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center`}
            >
              {icon}
            </div>
            <h3 className="text-base font-black text-gray-900">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>

        <p className="text-sm text-gray-500 px-5 pt-3 pb-4 leading-relaxed">
          {description}
        </p>

        {/* Scrollable content */}
        <div className="px-5 space-y-2 max-h-52 overflow-y-auto">
          {children}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 p-5">{actions}</div>
      </div>
    </div>
  );
}

export function ModalButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: "ghost" | "primary";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 ${
        variant === "ghost"
          ? "border border-gray-200 text-gray-600 hover:bg-gray-50"
          : "bg-primary text-white shadow-md shadow-primary/20 hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}
