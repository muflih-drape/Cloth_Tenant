import { SizeRangeProvider } from "@/context/SizeRangeContext";

export default function NoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <SizeRangeProvider>{children}</SizeRangeProvider>
    </div>
  );
}
