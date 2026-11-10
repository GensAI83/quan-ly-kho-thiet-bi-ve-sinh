// Minimal standalone type surface of `@hatch/space-sdk/client`.
// Only the types the client (`client/src/api.ts`, `client/src/main.tsx`,
// `client/src/App.tsx`) uses are declared here; this is NOT the full Muse
// SDK. Runtime behaviour lives in `dist/client.js`.

import { QueryClient } from "@tanstack/react-query";
import type { ZodType } from "zod";
import type { CSSProperties, HTMLAttributes } from "react";
import type { ActionRequest, ActionResponse } from "./index";

export type { ActionRequest, ActionResponse };

/** Marker string so a built bundle can be proven to use this shim. */
export declare const STANDALONE_SHIM_MARKER: "space-sdk-shim/1.0";

/**
 * Error thrown by a {@link createActionClient} call when the server returns
 * a non-OK HTTP response. Carries the HTTP `status` so retry policy can tell
 * a permanent client error (4xx) apart from retryable failures, and the
 * server's `Retry-After` (when present) as `retryAfterMs`.
 */
export declare class SpaceActionError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number | undefined;
  readonly retrySafe: boolean;
  readonly code?: string | undefined;
  constructor(
    message: string,
    status: number,
    retryAfterMs?: number | undefined,
    retrySafe?: boolean,
    code?: string | undefined,
  );
}

export declare const PERMANENT_ACTION_STATUSES: Set<number>;

/** Retries after the first failure for a retryable action error. */
export declare const MAX_ACTION_RETRIES: 3;

/**
 * Default retry predicate for Space action queries, used by
 * {@link spaceQueryClient}. Retry only explicit pre-invocation failures,
 * with bounded backoff.
 */
export declare function shouldRetryAction(
  failureCount: number,
  error: unknown,
): boolean;

/**
 * Retry delay for Space action queries: exponential backoff with full
 * jitter, honoring the server's `Retry-After` as a floor.
 */
export declare function actionRetryDelay(
  failureCount: number,
  error: unknown,
): number;

/**
 * Shared TanStack Query client for every Muse Space.
 *
 *   import { spaceQueryClient } from "@hatch/space-sdk/client";
 *   import { QueryClientProvider } from "@tanstack/react-query";
 *
 *   <QueryClientProvider client={spaceQueryClient}>
 *     <App />
 *   </QueryClientProvider>
 */
export declare const spaceQueryClient: QueryClient;

/**
 * Request shape for an action on a typed action client, by name.
 *
 *     import { api } from "./api";
 *     import type { ApiRequest } from "@hatch/space-sdk/client";
 *     type Filter = ApiRequest<typeof api, "listArticles">;
 */
export type ApiRequest<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Parameters<C[K]>[0];

/**
 * Response shape for an action on a typed action client, by name.
 *
 *     import { api } from "./api";
 *     import type { ApiResponse } from "@hatch/space-sdk/client";
 *     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
 */
export type ApiResponse<
  C extends Record<string, (args: never) => Promise<unknown>>,
  K extends keyof C,
> = Awaited<ReturnType<C[K]>>;

type ClientActionShape = {
  request: ZodType;
  response: ZodType;
};

export type ActionClient<A extends Record<string, ClientActionShape>> = {
  [K in keyof A]: (args: ActionRequest<A[K]>) => Promise<ActionResponse<A[K]>>;
};

interface ClientOptions {
  /** Override the action endpoint (defaults to `./actions` resolved against `location.href`). */
  endpoint?: string;
  /** Inject a custom fetch (mostly for tests). */
  fetch?: typeof globalThis.fetch;
}

export declare function createActionClient<
  A extends Record<string, ClientActionShape>,
>(options?: ClientOptions): ActionClient<A>;

// ---------------------------------------------------------------------------
// Safe-area scrim
// ---------------------------------------------------------------------------

export type SafeAreaTopScrimVariant = "gradient" | "blur" | "solid";

export interface SafeAreaTopScrimProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * Visual treatment for the protected top inset. The component always owns
   * the fixed positioning, z-index, pointer-events behavior, and height.
   */
  variant?: SafeAreaTopScrimVariant;
  /**
   * Background used to keep status-bar text readable. Defaults to `var(--bg)`.
   */
  backgroundColor?: CSSProperties["backgroundColor"];
  /**
   * Stacking layer for the fixed scrim. Defaults to 40 to match z-40.
   */
  zIndex?: CSSProperties["zIndex"];
}

/**
 * Fixed top safe-area protection for Spaces without a top-extending header.
 */
export declare function SafeAreaTopScrim(
  props: SafeAreaTopScrimProps,
): import("react").DetailedReactHTMLElement<
  {
    "aria-hidden": boolean | "false" | "true";
    className: string | undefined;
    style: CSSProperties;
  },
  HTMLElement
>;

// ---------------------------------------------------------------------------
// Viewer stubs (standalone has no host Muse, so the viewer is always null).
// ---------------------------------------------------------------------------

export interface SpacePerson {
  readonly id: string;
  readonly name?: string;
}

export interface SpacePresentPerson extends SpacePerson {
  readonly sinceMs?: number;
}

export type SpaceRole = "view" | "use" | "edit";

export interface SpaceViewer {
  readonly you: SpacePerson | null;
  readonly host: SpacePerson | null;
  readonly present: readonly SpacePresentPerson[];
}

export type SpaceViewerEvent =
  | { type: "join"; person: SpacePresentPerson }
  | { type: "leave"; person: SpacePresentPerson }
  | { type: "change"; by?: string; atMs?: number };

/**
 * Who is viewing this Space. Null when the Space has no viewer context —
 * always the case in the standalone build.
 */
export declare function getSpaceViewer(): Promise<SpaceViewer | null>;

/**
 * Follow the viewer context while the page is visible. Standalone: returns
 * a no-op unsubscribe.
 */
export declare function subscribeSpaceViewer(
  listener: (viewer: SpaceViewer | null, event?: SpaceViewerEvent) => void,
): () => void;

/** React hook form of {@link subscribeSpaceViewer}: always null standalone. */
export declare function useSpaceViewer(): SpaceViewer | null;

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

/** Base64-encode raw bytes. */
export declare function bytesToBase64(bytes: Uint8Array): string;

/**
 * Read a browser `File`/`Blob` into the `{ dataBase64, mimeType }` shape.
 */
export declare function fileToBase64(file: Blob): Promise<{
  dataBase64: string;
  mimeType: string;
}>;
