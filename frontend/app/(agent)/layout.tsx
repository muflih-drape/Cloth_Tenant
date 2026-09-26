import PushNotificationInit from "@/lib/pushInit";
import NavBar from "../../components/ui/NavBar";
import AgentProfileButton from "@/components/ui/custom/agentProfileButton";
import { SizeRangeProvider } from "@/context/SizeRangeContext";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="main-layout pb-32">
      <SizeRangeProvider>
        <PushNotificationInit />
        <AgentProfileButton />
        {children}
        <NavBar />
      </SizeRangeProvider>
    </div>
  );
}
