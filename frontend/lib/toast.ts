import { toast as sonner } from "sonner";

type ToastType = "success" | "error" | "warning";
interface ToastOptions {
  title: string;
  description?: string;
}

function parseApiError(error: any): string {
  try {
    const status = error?.response?.status;

    // Reverse proxy rejected the body before it reached Django. Browsers
    // surface this as a bare "Network Error" when CORS headers are missing.
    if (status === 413) {
      return "Image is too large. Please pick a smaller photo and try again.";
    }

    // Request never got a response (offline, server down, or proxy reset).
    if (!error?.response && error?.request) {
      if (error?.code === "ERR_NETWORK") {
        return "Server unreachable. Check your connection and try again.";
      }
      if (error?.code === "ECONNABORTED") {
        return "Request timed out. Try again.";
      }
      return "Could not reach the server. Check your connection and try again.";
    }

    // Axios-style response
    const data = error?.response?.data;

    if (data) {
      // Django sent HTML (e.g. 500 debug page)
      if (typeof data === "string") {
        const message = data.includes("<html")
          ? "Server error, please try again"
          : data;
        return status ? `${message} (HTTP ${status})` : message;
      }

      if (typeof data === "object") {
        // { error: "..." } or { detail: "..." }
        if (typeof data.error === "string")
          return status ? `${data.error} (HTTP ${status})` : data.error;
        if (typeof data.detail === "string")
          return status ? `${data.detail} (HTTP ${status})` : data.detail;

        // DRF field errors: { username: ["..."], email: ["..."] }
        const messages = Object.entries(data)
          .flatMap(([field, val]) => {
            if (Array.isArray(val)) return val.map((m) => `${field}: ${m}`);
            if (typeof val === "string") return [`${field}: ${val}`];
            return [];
          })
          .join("\n");
        if (messages) return status ? `${messages} (HTTP ${status})` : messages;
      }
    }

    // Flat error object (no response wrapper)
    if (error?.data?.detail) return error.data.detail;
    if (error?.data?.message) return error.data.message;
    if (error?.message) return error.message;
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
  } catch {
    // never crash the toast
  }

  return "Something went wrong";
}

function showToast(type: ToastType, { title, description }: ToastOptions) {
  const options = {
    duration: type === "warning" ? 5000 : 3000,
    ...(description && { description }),
  };
  if (type === "success") {
    sonner.success(title, options);
  } else if (type === "warning") {
    sonner.warning(title, options);
  } else {
    sonner.error(title, options);
  }
}

export function toastWarning(title: string, description?: string) {
  showToast("warning", { title, description });
}

export function toastSuccess(title: string, description?: string) {
  showToast("success", { title, description });
}

export function toastError(titleOrError: string | any, error?: any) {
  if (typeof titleOrError !== "string") {
    // called as toastError(e) — treat it like toastErrorFromError
    const message = parseApiError(titleOrError);
    showToast("error", { title: message });
    return;
  }
  const description = error ? parseApiError(error) : undefined;
  showToast("error", { title: titleOrError, description });
}

export function toastErrorFromError(error: any) {
  const message = parseApiError(error);
  showToast("error", { title: message });
}
