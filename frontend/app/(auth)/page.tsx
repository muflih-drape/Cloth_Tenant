"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import { useAuth } from "@/context/AuthContext";
import { authApi } from "@/lib/api";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { AuthCard } from "@/components/pages/auth/AuthCard";
import { AuthBranding } from "@/components/pages/auth/AuthBranding";
import { AuthAlert } from "@/components/pages/auth/AuthAlert";
import { AuthSubmitButton } from "@/components/pages/auth/AuthSubmitButton";
import { PasswordInput } from "@/components/pages/auth/PasswordInput";
import { Input } from "@/components/ui/input";

type ErrorType =
  | "network"
  | "cors"
  | "wrong_password"
  | "no_account"
  | "generic"
  | null;

const ERROR_MESSAGES: Record<
  NonNullable<ErrorType>,
  { title: string; sub?: string; warn?: boolean }
> = {
  network: {
    title: "No internet connection",
    sub: "Check your connection and try again.",
  },
  cors: {
    title: "Cannot reach the server",
    sub: "This may be a network or CORS issue — contact your admin if this persists.",
    warn: true,
  },
  wrong_password: {
    title: "Wrong password",
    sub: "Double-check your password and try again.",
  },
  no_account: { title: "No account found for this email" },
  generic: {
    title: "Sign-in failed",
    sub: "Something went wrong. Please try again.",
  },
};

function classifyError(err: any): NonNullable<ErrorType> {
  const error = err as {
    response?: { status?: number; data?: { error?: string } };
    code?: string;
  };
  if (!error.response) return error.code === "200" ? "network" : "cors";
  const status: number = error.response.status!;
  const msg = (error.response?.data?.error ?? "").toLowerCase();
  if (status === 400 || status === 401) {
    if (
      msg.includes("email") ||
      msg.includes("not found") ||
      msg.includes("no account")
    )
      return "no_account";
    if (msg.includes("password") || msg.includes("invalid credentials"))
      return "wrong_password";
  }
  return "generic";
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorType, setErrorType] = useState<ErrorType>(null);
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [shake, setShake] = useState(false);
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const triggerShake = () => {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  };

  const validate = (): boolean => {
    const errs = { email: "", password: "" };
    if (!email.trim()) errs.email = "Email is required";
    if (!password) errs.password = "Password is required";
    if (errs.email || errs.password) {
      setFieldErrors(errs);
      triggerShake();
      return false;
    }
    return true;
  };

  const handleLogin = async () => {
    setErrorType(null);
    setFieldErrors({ email: "", password: "" });
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      login(res);
      router.replace(res.role === "ADMIN" ? "/admin" : "/agent");
    } catch (err: any) {
      setErrorType(classifyError(err));
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    field: "email" | "password",
  ) => {
    if (e.key !== "Enter") return;
    if (field === "email") document.getElementById("password")?.focus();
    else handleLogin();
  };

  const error = errorType ? ERROR_MESSAGES[errorType] : null;

  return (
    <div className="flex min-h-screen min-w-full justify-center items-center px-6 py-10">
      <AuthCard shake={shake} onShakeEnd={() => setShake(false)}>
        <AuthBranding />

        {error && (
          <AuthAlert message={error.title} sub={error.sub} warn={error.warn} />
        )}

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
              onKeyDown={(e) => handleKeyDown(e, "email")}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              className={cn(
                fieldErrors.email &&
                  "border-red-400 bg-red-50 focus:ring-red-200",
              )}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-xs text-red-500 mt-1">
                {fieldErrors.email}
              </p>
            )}
          </Field>

          <PasswordInput
            id="password"
            label="Password"
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "password")}
            error={fieldErrors.password}
          />

          <div className="flex justify-end -mt-2">
            <Link
              href="/forgot-password"
              className="text-xs text-[var(--color-primary)] hover:opacity-70 transition-opacity"
            >
              Forgot password?
            </Link>
          </div>

          <AuthSubmitButton
            loading={loading}
            icon={<LogIn size={18} />}
            label="Sign in"
            loadingLabel="Signing in…"
            onClick={handleLogin}
          />
        </div>
      </AuthCard>
    </div>
  );
}
