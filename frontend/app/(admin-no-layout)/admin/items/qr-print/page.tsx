import QRPrintPageContent from "@/components/pages/items/qr/QRPageContent";
import { PageLoading } from "@/components/ui/Loading";
import { Suspense } from "react";

export default function QRPrintPage() {
    return (
        <Suspense fallback={<PageLoading />}>
            <QRPrintPageContent />
        </Suspense>
    );
}
