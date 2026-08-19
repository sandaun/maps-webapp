import type { Metadata } from "next";
import { JetBrains_Mono, Lato, Saira } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { CurrentProjectProvider } from "@/lib/current-project";
import { GatewaySessionProvider } from "@/lib/gateway-session";
import { WorkspaceChromeProvider } from "@/lib/workspace-chrome";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-lato",
  display: "swap",
  preload: true,
});

const saira = Saira({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-saira",
  display: "swap",
  preload: true,
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "MAPS Web — KNX ↔ Modbus Master",
  description: "Configuration tool for Intesis IN-KNX-MBM gateways",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${lato.variable} ${saira.variable} ${jetBrainsMono.variable}`}>
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
