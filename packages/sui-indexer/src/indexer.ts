import type { PrismaClient } from "@prisma/client";
import type { SuiClient } from "@mysten/sui/client";
import type { EventId, SuiEventFilter } from "@mysten/sui/client";
import { cursorToString, stringToCursor } from "./cursor.js";
import { handleSuiEvent } from "./eventHandlers.js";

const ADAPTER_MODULE = "adapter_registry";
const STAKING_MODULE = "staking_pool";

export interface IndexerOptions {
  packageId: string;
  pollIntervalMs?: number;
  pageSize?: number;
  useSubscribe?: boolean;
}

export class SuiIndexer {
  private readonly prisma: PrismaClient;
  private readonly client: SuiClient;
  private readonly packageId: string;
  private readonly pollIntervalMs: number;
  private readonly pageSize: number;
  private readonly useSubscribe: boolean;
  private stopRequested = false;
  private unsubscribe: (() => Promise<void>) | null = null;

  constructor(prisma: PrismaClient, client: SuiClient, opts: IndexerOptions) {
    this.prisma = prisma;
    this.client = client;
    this.packageId = opts.packageId;
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.pageSize = opts.pageSize ?? 50;
    this.useSubscribe = opts.useSubscribe ?? false;
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  async run(): Promise<void> {
    if (this.useSubscribe) {
      await this.runSubscribe();
      return;
    }
    await this.runPollLoop();
  }

  private moduleFilter(module: string): SuiEventFilter {
    return {
      MoveModule: {
        package: this.packageId,
        module,
      },
    };
  }

  private async ensureCheckpointRow(): Promise<void> {
    await this.prisma.indexerCheckpoint.upsert({
      where: { id: "singleton" },
      create: { id: "singleton" },
      update: {},
    });
  }

  private async loadCheckpoint(): Promise<{ adapter: EventId | null; staking: EventId | null }> {
    await this.ensureCheckpointRow();
    const row = await this.prisma.indexerCheckpoint.findUniqueOrThrow({ where: { id: "singleton" } });
    return {
      adapter: stringToCursor(row.cursorAdapterModule),
      staking: stringToCursor(row.cursorStakingModule),
    };
  }

  private async saveAdapterCursor(c: EventId | null): Promise<void> {
    await this.prisma.indexerCheckpoint.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", cursorAdapterModule: cursorToString(c) },
      update: { cursorAdapterModule: cursorToString(c) },
    });
  }

  private async saveStakingCursor(c: EventId | null): Promise<void> {
    await this.prisma.indexerCheckpoint.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", cursorStakingModule: cursorToString(c) },
      update: { cursorStakingModule: cursorToString(c) },
    });
  }

  private async drainModule(
    module: string,
    initialCursor: EventId | null,
    saveCursor: (c: EventId | null) => Promise<void>,
  ): Promise<void> {
    let cursor: EventId | null = initialCursor;
    let more = true;
    while (more && !this.stopRequested) {
      const res = await this.client.queryEvents({
        query: this.moduleFilter(module),
        cursor: cursor ?? undefined,
        limit: this.pageSize,
        order: "ascending",
      });

      if (res.data.length === 0) {
        break;
      }

      for (const ev of res.data) {
        await handleSuiEvent(this.prisma, ev);
      }

      const last = res.data[res.data.length - 1];
      await saveCursor(last.id);
      cursor = last.id;
      more = res.hasNextPage;
    }
  }

  private async runPollLoop(): Promise<void> {
    while (!this.stopRequested) {
      const cp = await this.loadCheckpoint();
      await this.drainModule(ADAPTER_MODULE, cp.adapter, (c) => this.saveAdapterCursor(c));

      const cp2 = await this.loadCheckpoint();
      await this.drainModule(STAKING_MODULE, cp2.staking, (c) => this.saveStakingCursor(c));

      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  /**
   * WebSocket ile anlık dinleme (RPC `suix_subscribeEvent` — bazı ortamlarda devre dışı olabilir).
   */
  private async runSubscribe(): Promise<void> {
    const unsubA = await this.client.subscribeEvent({
      filter: this.moduleFilter(ADAPTER_MODULE),
      onMessage: async (event) => {
        await handleSuiEvent(this.prisma, event);
        await this.saveAdapterCursor(event.id);
      },
    });
    const unsubS = await this.client.subscribeEvent({
      filter: this.moduleFilter(STAKING_MODULE),
      onMessage: async (event) => {
        await handleSuiEvent(this.prisma, event);
        await this.saveStakingCursor(event.id);
      },
    });
    this.unsubscribe = async () => {
      await unsubA();
      await unsubS();
    };

    while (!this.stopRequested) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (this.unsubscribe) await this.unsubscribe();
  }
}
