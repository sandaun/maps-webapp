"use client";

import * as React from "react";
import type { NodeLocator } from "@/lib/project-types";
import { ModbusAIModal } from "./modbus-ai-modal";
import { ModbusScanModal } from "./modbus-scan-modal";

/** One entry point: documented maps first, undocumented exploration second. */
export function ModbusDiscoveryModal({
  initialLocator,
  onClose,
}: {
  initialLocator: NodeLocator;
  onClose: () => void;
}) {
  const [exploring, setExploring] = React.useState(false);
  const [documentJobId, setDocumentJobId] = React.useState<string>();
  return exploring ? (
    <ModbusScanModal
      initialLocator={initialLocator}
      onClose={onClose}
      onDocument={() => setExploring(false)}
    />
  ) : (
    <ModbusAIModal
      initialLocator={initialLocator}
      initialJobId={documentJobId}
      onJobSelected={setDocumentJobId}
      onClose={onClose}
      onExplore={() => setExploring(true)}
    />
  );
}
