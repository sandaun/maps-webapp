import { DemoBanner } from "@/components/demo-banner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";
import { ValidationPanel } from "@/components/validation-panel";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="ml-[228px] flex min-h-screen flex-col">
        <Header />
        <DemoBanner />
        <main className="w-full flex-1 p-6 pb-16">{children}</main>
      </div>
      <ValidationPanel />
    </div>
  );
}
