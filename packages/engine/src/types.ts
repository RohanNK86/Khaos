import type { Locator, Need, RunMode, StepTrace } from "@mcpify/contracts";

/** Driver-specific element handle. */
export type ElementRef = unknown;

export interface FileBlob {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What the engine needs from a browser (01-CONTRACTS §13). */
export interface Driver {
  goto(url: string): Promise<void>;
  url(): Promise<string>;
  /** Exactly one visible match, trying locators in order. */
  resolve(locators: Locator[]): Promise<{ handle: ElementRef; used: Locator } | null>;
  fill(el: ElementRef, value: string): Promise<void>;
  select(el: ElementRef, labelOrValue: string): Promise<void>;
  check(el: ElementRef, on: boolean): Promise<void>;
  click(el: ElementRef): Promise<void>;
  upload(el: ElementRef, file: FileBlob): Promise<void>;
  value(el: ElementRef): Promise<string>;
  text(el: ElementRef): Promise<string>;
  isVisible(locators: Locator[]): Promise<boolean>;
  pageText(): Promise<string>;
  hasErrorNear(el: ElementRef): Promise<boolean>;
  snapshot(): Promise<string>;
  waitForSettled(timeoutMs: number): Promise<void>;
  /** Optional: visible validation messages on the page (used in failure messages). */
  errors?(): Promise<string[]>;
}

export interface NeedAnswer {
  approve?: boolean;
  value?: string;
}

export interface RunHooks {
  onNeed(need: Need): Promise<NeedAnswer>;
  onStep?(trace: StepTrace): void;
  saveBlob?(content: string, mime: string): Promise<string>;
  /** Optional: turn an upload param (a file reference) into bytes. */
  loadFile?(ref: string): Promise<FileBlob>;
}

export interface RunOptions {
  dryRun: boolean;
  mode: RunMode;
  startIndex?: number;
  signal?: AbortSignal;
  /** Optional fixed run id (the caller may need it before the run ends). */
  runId?: string;
  /** Commit steps already executed in an earlier attempt of this run (idempotency on resume). */
  committedStepIds?: string[];
}
