import type { BlobStore, Signer } from "@mcpify/storage";
import type { RunManager } from "./runs/run-manager.js";
import type { Store } from "./store.js";

/** Everything a route needs. */
export interface Ctx {
  store: Store;
  blobs: BlobStore;
  signer: Signer;
  runs: RunManager;
}
