// Minimal standalone type surface of `@hatch/space-sdk` (server side).
// Only the types `server/src/actions.ts` uses are declared here; this is
// NOT the full Muse SDK. Runtime behaviour lives in `dist/index.js`.

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

export { z };

/** A loose JSON value used by streaming `ctx.emit` frames. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Portable typed drizzle-orm DB surface for Muse Spaces.
 * The conservative portable subset supported across runtimes. `batch` is
 * available; `transaction` is intentionally NOT exposed (same as the real SDK).
 */
export type SpaceDb<
  TSchema extends Record<string, unknown> = Record<string, never>,
> = Pick<
  LibSQLDatabase<TSchema>,
  "select" | "insert" | "update" | "delete" | "run" | "all" | "get" | "batch"
>;

/** Per-invocation typed DB accessor. */
export type SpaceDbAccessor = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>() => SpaceDb<TSchema>;

/** Marker string so a built bundle can be proven to use this shim. */
export declare const STANDALONE_SHIM_MARKER: "space-sdk-shim/1.0";

/** Runtime-neutral context fields available to portable Space actions. */
export interface PortableCtx {
  readonly slug: string;
  readonly invocationId: string;
  readonly spaceDir: string;
  readonly db: SpaceDbAccessor;
}

/** Per-invocation context passed to every action handler (standalone). */
export interface Ctx extends PortableCtx {
  /**
   * Signal every open client for this Space to refetch React Query data.
   * In the standalone build there is no cross-client broadcast, so the
   * server passes a no-op; the client already invalidates its own queries
   * in each mutation's `onSuccess`.
   */
  invalidateQueries(invalidation?: unknown): void;
}

/** Versioned brand. Identifies a value as an action definition. */
export declare const ACTION_BRAND: "@hatch/space-sdk/action/v1";

export interface ActionDefinition<
  TCtx extends PortableCtx = PortableCtx,
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  readonly __brand: typeof ACTION_BRAND;
  readonly request: Req;
  readonly response: Res;
  readonly description?: string;
  readonly privileged?: readonly unknown[];
  readonly handler: (ctx: TCtx, args: z.infer<Req>) => Promise<z.infer<Res>>;
}

export type ActionFactoryInput<
  TCtx extends PortableCtx,
  Req extends z.ZodType,
  Res extends z.ZodType,
> = {
  request: Req;
  response: Res;
  /** One sentence telling the user's agent what the action does. */
  description?: string;
  privileged?: readonly unknown[];
  handler: (ctx: TCtx, args: z.infer<Req>) => Promise<z.infer<Res>>;
};

/** Both runtimes list actions through this, so local and shared catalogs agree. */
export declare function actionDescription(
  definition: Pick<ActionDefinition, "description">,
): string | undefined;

/** Bind the shared action implementation to a runtime-specific Ctx type. */
export declare function createDefineAction<TCtx extends PortableCtx>(): <
  Req extends z.ZodType,
  Res extends z.ZodType,
>(
  spec: ActionFactoryInput<TCtx, Req, Res>,
) => ActionDefinition<TCtx, Req, Res>;

/** Runtime check used by workers to filter module exports. */
export declare function isAction(value: unknown): value is ActionDefinition;

/**
 * Define a single action. The schemas drive both runtime validation (in the
 * standalone server) and static typing (on the client via
 * `createActionClient`).
 */
export declare const defineAction: <
  Req extends z.ZodType,
  Res extends z.ZodType,
>(
  spec: ActionFactoryInput<Ctx, Req, Res>,
) => ActionDefinition<Ctx, Req, Res>;

/**
 * The shape every space's `actions.ts` must satisfy. Use as
 * `} satisfies ActionsModule;` to flag stray non-action values without
 * widening the inferred type — call-site typing on the client stays precise
 * per-action.
 */
export type ActionsModuleFor<TCtx extends PortableCtx> = Record<
  string,
  Omit<ActionDefinition<TCtx>, "handler"> & {
    handler: (ctx: TCtx, args: any) => Promise<any>;
  }
>;

export type ActionsModule = ActionsModuleFor<Ctx>;

/** Extract the request payload type for a given action. */
export type ActionRequest<A extends { request: z.ZodType }> = z.infer<
  A["request"]
>;

/** Extract the response payload type for a given action. */
export type ActionResponse<A extends { response: z.ZodType }> = z.infer<
  A["response"]
>;
