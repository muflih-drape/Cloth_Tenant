"use client";
import AgentOrderList from "@/components/pages/agent/orderList/OrderList";
import { Modal, ModalButton } from "@/components/ui/custom/Modals";
import { useBackButton } from "@/util/useBackButton";
import { AlertTriangle } from "lucide-react";
import { useCallback, useState } from "react";

export default function Home() {
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  useBackButton({
    onBack: useCallback(() => {
      setShowLeaveConfirm(true);
    }, []),
  });
  return (
    <div className="min-h-screen min-w-full">
      <AgentOrderList />

      {showLeaveConfirm && (
        <Modal
          icon={<AlertTriangle size={18} className="text-red-500" />}
          iconBg="bg-red-100"
          title="Leave the App?"
          description="Are you sure you want to exit the app?"
          onClose={() => setShowLeaveConfirm(false)}
          actions={
            <>
              <ModalButton
                variant="ghost"
                onClick={() => setShowLeaveConfirm(false)}
              >
                Stay
              </ModalButton>

              <ModalButton
                variant="primary"
                onClick={() => {
                  setShowLeaveConfirm(false);
                  window.close();
                }}
              >
                Leave
              </ModalButton>
            </>
          }
        ></Modal>
      )}
    </div>
  );
}
