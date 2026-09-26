import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const jakartha = Plus_Jakarta_Sans({
  variable: "--font-jakartha",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "XL Apparals",
  description: "Control your stock seamlessly.",
  appleWebApp: {
    capable: true,
    title: "StockFlow",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "StockFlow",
    description: "Control your stock seamlessly",
    url: "https://xlapparals.in/",
    siteName: "XL Apparals",
    images: [
      {
        url: "/opengraph.jpg",
        width: 1200,
        height: 630,
        alt: "StockFlow App",
      },
    ],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jakartha.className} antialiased py-4 px-5`}>
        <AuthProvider>
          <ServiceWorkerRegister />
          {children}
        </AuthProvider>
        <Toaster
          position="top-right"
          richColors
          toastOptions={{ duration: 3000 }}
        />
      </body>
    </html>
  );
}
