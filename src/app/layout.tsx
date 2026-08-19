import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { CurrentProjectProvider } from "@/lib/current-project";
import { GatewaySessionProvider } from "@/lib/gateway-session";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";

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
          <GatewaySessionProvider>
            <WorkspaceChromeProvider>
              <AppShell>{children}</AppShell>
            </WorkspaceChromeProvider>
          </GatewaySessionProvider>
        </CurrentProjectProvider>
      </body>
    </html>
  );
}
