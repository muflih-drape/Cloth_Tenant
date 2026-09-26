"use client";

import { authApi } from "@/lib/api";
import { CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import { AuthCard } from "@/components/pages/auth/AuthCard";
import { AuthBranding } from "@/components/pages/auth/AuthBranding";
import { AuthAlert } from "@/components/pages/auth/AuthAlert";
import { AuthSubmitButton } from "@/components/pages/auth/AuthSubmitButton";
import { AuthBackLink } from "@/components/pages/auth/AuthBackLink";
import { PasswordInput } from "@/components/pages/auth/PasswordInput";

type Status = "idle" | "loading" | "success" | "error";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState({ password: "", confirm: "" });
  const [shake, setShake] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const hasInitialized = useRef<boolean | undefined>(undefined);

  if (hasInitialized.current == null) {
    hasInitialized.current = true;
    if (!token) {
      setErrorMsg("Invalid or missing reset link. Please request a new one.");
      setStatus("error");
    }
  }

  useEffect(() => {
    if (token) {
      passwordRef.current?.focus();
    }
  }, [token]);

  const triggerShake = () => {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  };

  const validate = (): boolean => {
    const errs = { password: "", confirm: "" };
    if (!password) errs.password = "Password is required.";
    else if (password.length < 8)
      errs.password = "Must be at least 8 characters.";
    if (!confirm) errs.confirm = "Please confirm your password.";
    else if (password !== confirm) errs.confirm = "Passwords do not match.";
    if (errs.password || errs.confirm) {
      setFieldErrors(errs);
      triggerShake();
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    setErrorMsg("");
    setFieldErrors({ password: "", confirm: "" });
    if (!validate()) return;
    setStatus("loading");
    try {
      await authApi.resetPassword({ token, password });
      setStatus("success");
    } catch (err: any) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Something went wrong. Please try again.";
      setErrorMsg(msg);
      triggerShake();
      setStatus("idle");
    }
  };

  return (
    <div className="flex min-h-screen min-w-full bg-gray-50 justify-center items-center px-6 py-10">
      <AuthCard shake={shake} onShakeEnd={() => setShake(false)}>
        <AuthBranding />

        {status === "success" ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle2 size={30} className="text-green-500" />
            </div>
            <div>
              <p className="font-semibold text-[var(--color-heading)] text-base">
                Password updated!
              </p>
              <p className="text-sm text-[var(--color-text)] mt-1">
                Your password has been reset successfully. You can now sign in
                with your new password.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className={cn(
                "w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-medium text-white transition-all",
                "bg-[var(--color-primary)] hover:opacity-90 active:scale-[0.98]",
              )}
            >
              Go to sign in
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--color-heading)]">
                Set a new password
              </h2>
              <p className="text-sm text-[var(--color-text)]">
                Must be at least 8 characters long.
              </p>
            </div>

            <AuthAlert
              message={errorMsg}
              suffix={
                errorMsg.toLowerCase().includes("expired") ||
                errorMsg.toLowerCase().includes("invalid") ? (
                  <Link
                    href="/forgot-password"
                    className="text-xs mt-0.5 underline opacity-80 hover:opacity-100"
                  >
                    Request a new link
                  </Link>
                ) : null
              }
            />

            <div className="flex flex-col gap-5">
              <PasswordInput
                ref={passwordRef}
                id="password"
                label="New password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    document.getElementById("confirm")?.focus();
                }}
                error={fieldErrors.password}
              />

              <PasswordInput
                id="confirm"
                label="Confirm new password"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                error={fieldErrors.confirm}
              />

              <AuthSubmitButton
                loading={status === "loading"}
                icon={<KeyRound size={16} />}
                label="Reset password"
                loadingLabel="Updating…"
                onClick={handleSubmit}
              />
            </div>
          </>
        )}

        {status !== "success" && <AuthBackLink href="/" />}
      </AuthCard>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
