import "server-only";
import { Socket } from "node:net";

/**
 * Minimal duplex byte-channel abstraction so sessions can run over a real
 * TCP socket (TcpDuplex) or a scripted fake server in tests — no network is
 * required to exercise the session state machine.
 */
export interface Duplex {
  /** Queue bytes for sending. */
  write(data: Uint8Array): void;
  /**
   * Read whatever bytes arrive within `timeoutMs`.
   * Resolves with an empty chunk on timeout, `null` on EOF/closed.
   */
  read(timeoutMs: number): Promise<Uint8Array | null>;
  close(): void;
}

/** TCP adapter over node:net (gateway control channel is TCP/23, PROTOCOL.md §3). */
export class TcpDuplex implements Duplex {
  private socket: Socket | undefined;
  private queue: Uint8Array[] = [];
  private waiters: ((chunk: Uint8Array | null) => void)[] = [];
  private closed = false;

  static connect(host: string, port: number, timeoutMs: number): Promise<TcpDuplex> {
    return new Promise((resolve, reject) => {
      const duplex = new TcpDuplex();
      const socket = new Socket();
      duplex.socket = socket;
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`TCP connect to ${host}:${port} timed out`));
      }, timeoutMs);
      const onConnectError = (err: Error) => {
        clearTimeout(timer);
        duplex.closed = true;
        duplex.flush(null);
        reject(new Error(`TCP connect to ${host}:${port} failed: ${err.message}`));
      };
      socket.once("error", onConnectError);
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.off("error", onConnectError);
        socket.setKeepAlive(true);
        socket.on("data", (data: Buffer) => duplex.push(new Uint8Array(data)));
        socket.on("close", () => {
          duplex.closed = true;
          duplex.flush(null);
        });
        socket.on("error", () => {
          duplex.closed = true;
          duplex.flush(null);
        });
        resolve(duplex);
      });
    });
  }

  private push(chunk: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(chunk);
    else this.queue.push(chunk);
  }

  private flush(chunk: null): void {
    for (const waiter of this.waiters.splice(0)) waiter(chunk);
  }

  write(data: Uint8Array): void {
    if (this.closed || !this.socket) throw new Error("TCP connection is closed");
    this.socket.write(Buffer.from(data));
  }

  read(timeoutMs: number): Promise<Uint8Array | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(onData);
        if (i >= 0) this.waiters.splice(i, 1);
        resolve(new Uint8Array(0));
      }, timeoutMs);
      const onData = (chunk: Uint8Array | null) => {
        clearTimeout(timer);
        resolve(chunk);
      };
      this.waiters.push(onData);
    });
  }

  close(): void {
    this.closed = true;
    this.flush(null);
    this.socket?.destroy();
    this.socket = undefined;
  }
}
