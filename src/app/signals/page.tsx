import { Suspense } from "react";
import { SignalsScreen } from "@/components/screens/signals-screen";

export default function SignalsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-fg-muted">Loading signals…</p>}>
      <SignalsScreen />
    </Suspense>
  );
}
