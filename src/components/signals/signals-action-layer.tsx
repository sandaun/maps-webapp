"use client";

import * as React from "react";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";

/** The grid reserves scroll space for two independent controls outside its scroll pane. */
export const SignalsActionLayerContext = React.createContext<{ bar: React.ReactNode; inset: number } | null>(null);

export function SignalsActionLayer({ selection, selectionHeight, onInset }: {
  selection: React.ReactNode;
  selectionHeight: number;
  onInset: (inset: number) => void;
}) {
  const { undoVisible, setUndoContainer } = useWorkspaceChrome();
  const selectionRef = React.useRef<HTMLDivElement>(null);
  const undoRef = React.useRef<HTMLDivElement>(null);
  const [undoBottom, setUndoBottom] = React.useState(selectionHeight + 12);

  const registerUndo = React.useCallback((element: HTMLDivElement | null) => {
    undoRef.current = element;
    setUndoContainer(element);
  }, [setUndoContainer]);

  React.useLayoutEffect(() => {
    const selectionElement = selectionRef.current;
    const undoElement = undoRef.current;
    if (!selectionElement || !undoElement) return;
    const measure = () => {
      const height = selectionElement.getBoundingClientRect().height || selectionHeight;
      const offset = Math.ceil(height) + 12;
      setUndoBottom(offset);
      // Keep the upper slot fixed even when there is no selection. Only the
      // scroll reserve grows; the lower selection bar never changes position.
      const undoHeight = undoVisible ? undoElement.getBoundingClientRect().height || 40 : 0;
      onInset(Math.ceil(Math.max(selection ? height : 0, undoVisible ? offset + undoHeight : 0)) + 36);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(selectionElement);
    observer.observe(undoElement);
    return () => observer.disconnect();
  }, [selection, selectionHeight, undoVisible, onInset]);

  return (
    <>
      <div ref={selectionRef}>{selection}</div>
      <div ref={registerUndo} data-testid="signals-undo-slot" className="absolute inset-x-0 flex justify-center" style={{ bottom: undoBottom }} />
    </>
  );
}
