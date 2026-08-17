import { DemoBanner } from "@/components/demo-banner";
import { Header } from "@/components/header";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="ml-[228px] flex min-h-screen flex-col">
        <Header />
        <DemoBanner />
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
