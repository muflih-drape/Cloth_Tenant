"use client";

import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { authApi } from "@/lib/api";
import { Send, CheckCircle2 } from "lucide-react";
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AuthCard } from "@/components/pages/auth/AuthCard";
import { AuthBranding } from "@/components/pages/auth/AuthBranding";
import { AuthAlert } from "@/components/pages/auth/AuthAlert";
import { AuthSubmitButton } from "@/components/pages/auth/AuthSubmitButton";
import { AuthBackLink } from "@/components/pages/auth/AuthBackLink";

type Status = "idle" | "loading" | "success" | "error";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [shake, setShake] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const triggerShake = () => {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  };

  const handleSubmit = async () => {
    setErrorMsg("");
    if (!email.trim()) {
      setErrorMsg("Please enter your email address.");
      triggerShake();
      return;
    }
    setStatus("loading");
    try {
      await authApi.forgotPassword({ email: email.trim().toLowerCase() });
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(
        err?.response?.data?.error ?? "Something went wrong. Please try again.",
      );
      triggerShake();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
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
                Check your inbox
              </p>
              <p className="text-sm text-[var(--color-text)] mt-1">
                If{" "}
                <span className="font-medium text-[var(--color-heading)]">
                  {email}
                </span>{" "}
                is linked to an account, you&apos;ll receive a reset link
                shortly.
              </p>
            </div>
            <p className="text-xs text-gray-400">
              Didn&apos;t get it? Check your spam folder or{" "}
              <button
                className="underline text-[var(--color-primary)] hover:opacity-70 transition-opacity"
                onClick={() => {
                  setStatus("idle");
                  setEmail("");
                }}
              >
                try again
              </button>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--color-heading)]">
                Forgot your password?
              </h2>
              <p className="text-sm text-[var(--color-text)]">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <AuthAlert message={errorMsg} />

            <div className="flex flex-col gap-5">
              <Field>
                <FieldLabel htmlFor="email">Email address</FieldLabel>
                <Input
                  ref={emailRef}
                  id="email"
                  type="email"
                  placeholder="example@gmail.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  aria-invalid={!!errorMsg}
                  className={cn(
                    errorMsg && "border-red-400 bg-red-50 focus:ring-red-200",
                  )}
                />
              </Field>

              <AuthSubmitButton
                loading={status === "loading"}
                icon={<Send size={16} />}
                label="Send reset link"
                loadingLabel="Sending…"
                onClick={handleSubmit}
              />
            </div>
          </>
        )}

        <AuthBackLink href="/" />
      </AuthCard>
    </div>
  );
}
