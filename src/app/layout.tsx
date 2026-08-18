import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { CurrentProjectProvider } from "@/lib/current-project";

export const metadata: Metadata = {
  title: "MAPS Web — KNX ↔ Modbus Master",
  description: "Configuration tool for Intesis IN-KNX-MBM gateways",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CurrentProjectProvider>
          <AppShell>{children}</AppShell>
        </CurrentProjectProvider>
      </body>
    </html>
  );
}
