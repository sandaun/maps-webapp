import { describe, expect, it, vi } from "vitest";
import { createCellSaveQueue } from "./cell-queue";

describe("createCellSaveQueue", () => {
  it("sends the latest queued value after the in-flight request finishes", async () => {
    const sent: string[] = [];
    let releaseFirst!: () => void;
    const send = vi.fn((payload: string) => {
      sent.push(payload);
      if (payload === "one") {
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve();
    });
    const queue = createCellSaveQueue(send);

    const first = queue.enqueue("0:description", "one");
    queue.enqueue("0:description", "two");
    queue.enqueue("0:description", "three");
    expect(sent).toEqual(["one"]);

    releaseFirst();
    await first;
    expect(sent).toEqual(["one", "three"]);
  });

  it("does not drop a later value when the first send fails", async () => {
    const sent: string[] = [];
    let releaseFirst!: (err?: Error) => void;
    const send = vi.fn((payload: string) => {
      sent.push(payload);
      if (payload === "one") {
        return new Promise<void>((_resolve, reject) => {
          releaseFirst = (err) => reject(err ?? new Error("fail"));
        });
      }
      return Promise.resolve();
    });
    const queue = createCellSaveQueue(send);
    const first = queue.enqueue("0:description", "one");
    const second = queue.enqueue("0:description", "two");
    releaseFirst();
    await expect(first).resolves.toBeUndefined();
    await second;
    expect(sent).toEqual(["one", "two"]);
  });
});
