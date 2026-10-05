/** Fixed-capacity history with O(1) insertion; snapshots are chronological. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Invalid ring capacity");
    this.items = new Array(capacity);
  }

  get size() { return this.count; }

  push(item: T): void {
    this.items[(this.start + this.count) % this.capacity] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  snapshot(): T[] {
    return Array.from({ length: this.count }, (_, i) => this.items[(this.start + i) % this.capacity]!);
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = this.count = 0;
  }
}
