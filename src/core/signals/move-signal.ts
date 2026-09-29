import { getAttr, type XmlElement } from "@/core/project-format";

export function moveAlignedSignal(sides: XmlElement[][], id: number, toIndex: number, count = 1): boolean {
  const sourceIndex = sides[0]?.findIndex((node) => getAttr(node, "ID") === String(id)) ?? -1;
  const total = sides[0]?.length ?? 0;
  if (sourceIndex < 0 || !Number.isInteger(count) || count < 1 || sourceIndex + count > total ||
    !Number.isInteger(toIndex) || toIndex < 0 || toIndex > total - count) {
    throw new Error("Invalid signal move.");
  }
  for (const side of sides) {
    if (side.length !== total || side.some((node, index) =>
      !node.parent || node.parent !== side[0].parent ||
      getAttr(node, "ID") !== getAttr(sides[0][index], "ID"))) {
      throw new Error("The protocol signal rows are not aligned.");
    }
  }
  if (sourceIndex === toIndex) return false;
  for (const side of sides) {
    const reordered = [...side];
    const moved = reordered.splice(sourceIndex, count);
    reordered.splice(toIndex, 0, ...moved);
    const positions = new Map(side.map((node, index) => [node, index]));
    const parent = side[0].parent!;
    parent.children = parent.children.map((node) => {
      const index = node.kind === "element" ? positions.get(node) : undefined;
      return index === undefined ? node : reordered[index];
    });
  }
  return true;
}