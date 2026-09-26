import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function AuthBackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 text-sm text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors"
    >
      <ArrowLeft size={14} />
      Back to sign in
    </Link>
  );
}
