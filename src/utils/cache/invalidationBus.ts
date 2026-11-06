import type { SQL } from "bun";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import type { ShardTopology } from "@/utils/discord/shardOwnership";

export const INVALIDATION_CHANNEL = "tomori_cache";
// PostgreSQL rejects payloads of 8,000 bytes or more, so leave room below that limit.
export const INVALIDATION_MAX_BYTES = 7_500;

export const invalidationKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^\P{Cc}+$/u);
export const invalidationDatabaseId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

type WireArguments = readonly (string | null)[];
interface Subscription {
  unlisten(): Promise<void>;
}

// Declare Bun 1.4.0 listener APIs here because the installed bun-types package predates them.
export interface InvalidationTransport {
  listen(channel: string, receive: (payload: string) => void, subscribed: () => void): Promise<Subscription>;
  notify(channel: string, payload: string): Promise<unknown>;
}

interface Registration {
  apply(args: unknown): boolean;
  flush(): void;
}

const envelope = z.strictObject({
  v: z.literal(1),
  s: z.uuid(),
  k: z.string().min(1).max(64),
  a: z
    .array(z.array(z.union([invalidationKey, z.null()])).max(3))
    .min(1)
    .max(1_024),
});

let localDepth = 0;

export function withoutInvalidationBroadcast(work: () => void): void {
  localDepth++;
  try {
    work();
  } finally {
    localDepth--;
  }
}

export class InvalidationBus {
  private readonly sender = crypto.randomUUID();
  private readonly registrations = new Map<string, Registration>();
  private readonly pending = new Set<Promise<void>>();
  private transport: InvalidationTransport | undefined;
  private subscription: Subscription | undefined;
  private starting: Promise<void> | undefined;
  private enabled = false;
  private flushSucceeded = true;

  // Callbacks must stay synchronous so nested invalidators cannot publish after suppression ends.
  register<T>(kind: string, schema: z.ZodType<T>, evict: (args: T) => void, flush: () => void): void {
    if (this.registrations.has(kind)) throw new Error("Duplicate cache invalidation kind");
    this.registrations.set(kind, {
      apply(args) {
        const parsed = schema.safeParse(args);
        if (!parsed.success) return false;
        evict(parsed.data);
        return true;
      },
      flush,
    });
  }

  start(client: SQL | InvalidationTransport, topology: Pick<ShardTopology, "ownsAllShards">): Promise<void> {
    if (topology.ownsAllShards()) return Promise.resolve();
    if (this.starting) return this.starting;
    this.transport = client as InvalidationTransport;
    this.starting = this.subscribe(this.transport);
    return this.starting;
  }

  private async subscribe(transport: InvalidationTransport): Promise<void> {
    try {
      this.subscription = await transport.listen(
        INVALIDATION_CHANNEL,
        (payload) => this.receive(payload),
        () => {
          this.flushSucceeded = this.flush();
        },
      );
      if (!this.flushSucceeded) {
        await this.subscription.unlisten();
        throw new Error("Initial cache invalidation flush failed");
      }
      this.enabled = true;
    } catch {
      this.starting = undefined;
      this.report("subscribe");
      throw new Error("Cache invalidation subscription failed");
    }
  }

  async stop(): Promise<void> {
    this.enabled = false;
    try {
      await this.starting;
      this.enabled = false;
      await this.subscription?.unlisten();
      await Promise.allSettled(this.pending);
    } catch {
      this.report("stop");
    } finally {
      this.subscription = undefined;
      this.transport = undefined;
      this.starting = undefined;
    }
  }

  publish(kind: string, tuples: Iterable<WireArguments>): void {
    const transport = this.transport;
    if (!this.enabled || !transport || localDepth > 0) return;
    if (!this.registrations.has(kind)) {
      this.report("unknown_kind");
      return;
    }
    let chunk: WireArguments[] = [];
    const encode = () => JSON.stringify({ v: 1, s: this.sender, k: kind, a: chunk });
    let bytes = Buffer.byteLength(encode());
    for (const tuple of tuples) {
      const tupleBytes = Buffer.byteLength(JSON.stringify(tuple));
      if (bytes + tupleBytes + (chunk.length > 0 ? 1 : 0) > INVALIDATION_MAX_BYTES || chunk.length === 1_024) {
        this.send(encode(), kind, transport);
        chunk = [];
        bytes = Buffer.byteLength(encode());
      }
      if (bytes + tupleBytes > INVALIDATION_MAX_BYTES) {
        this.report("oversize", kind);
        continue;
      }
      bytes += tupleBytes + (chunk.length > 0 ? 1 : 0);
      chunk.push(tuple);
    }
    if (chunk.length > 0) this.send(encode(), kind, transport);
  }

  private send(payload: string, kind: string, transport: InvalidationTransport): void {
    const task = Promise.resolve()
      .then(() => transport.notify(INVALIDATION_CHANNEL, payload))
      .then(
        () => undefined,
        () => this.report("publish", kind),
      );
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  private receive(payload: string): void {
    try {
      if (Buffer.byteLength(payload) > INVALIDATION_MAX_BYTES) {
        this.report("malformed");
        return;
      }
      const message = envelope.safeParse(JSON.parse(payload));
      if (!message.success) {
        this.report("malformed");
        return;
      }
      const { s, k, a } = message.data;
      if (s === this.sender) return;
      const registration = this.registrations.get(k);
      if (!registration) {
        this.report("unknown_kind");
        return;
      }
      withoutInvalidationBroadcast(() => {
        for (const args of a) {
          try {
            if (!registration.apply(args)) this.report("malformed", k);
          } catch {
            this.report("handler", k);
          }
        }
      });
    } catch {
      this.report("malformed");
    }
  }

  private flush(): boolean {
    let succeeded = true;
    withoutInvalidationBroadcast(() => {
      for (const [kind, registration] of this.registrations) {
        try {
          registration.flush();
        } catch {
          succeeded = false;
          this.report("flush", kind);
        }
      }
    });
    return succeeded;
  }

  private report(phase: string, kind?: string): void {
    log.metric(`cache_invalidation_${phase}_failed`, { kind: kind ?? "unknown" });
    log.warn("Cache invalidation failed", undefined, { metadata: { phase, kind } });
  }
}

export const invalidationBus = new InvalidationBus();
export const registerInvalidation = invalidationBus.register.bind(invalidationBus);
export const broadcastInvalidation = invalidationBus.publish.bind(invalidationBus);
export const startInvalidationBus = invalidationBus.start.bind(invalidationBus);
export const stopInvalidationBus = invalidationBus.stop.bind(invalidationBus);
