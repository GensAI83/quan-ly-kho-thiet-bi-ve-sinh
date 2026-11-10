// Minimal standalone re-implementation of the CLIENT side of
// `@hatch/space-sdk` (version 0.14.0 surface, as used by this app).
//
// This is NOT the full Muse SDK. It implements only what the client uses:
// `createActionClient`, `SpaceActionError`, the retry policy helpers,
// `spaceQueryClient`, `SafeAreaTopScrim`, the viewer stubs, and the base64
// helpers. Behaviour matches the real SDK's `dist/client.js` where it
// matters for the wire protocol:
//
//   - POST to `./actions` (resolved against `location.href`), body
//     `JSON.stringify({ action, args, actionCallId })`, headers
//     `content-type: application/json` + `x-request-id: <actionCallId>`.
//   - HTTP 200 with `{ data }` returns `data`; a 200 body with a truthy
//     `error` field throws `Error("action <name> error: ...")`.
//   - Non-OK responses throw `SpaceActionError` with message
//     `action <name> failed: <status> <body JSON>`.
//   - Retry policy: never retry the permanent statuses
//     400/401/403/404/409/413/415/422; otherwise retry only errors flagged
//     `retrySafe`, at most 3 times, with exponential backoff + full jitter.
//
// What is deliberately NOT implemented (no host Muse in standalone mode):
//   - Viewer context (`./_viewer` polling, cross-client invalidation
//     broadcasts, auth-refresh postMessage flow, host theme listener).
//     `getSpaceViewer()` resolves `null`, `subscribeSpaceViewer()` returns a
//     no-op unsubscribe, `useSpaceViewer()` returns `null`.
//   - The SDK `styles.css` side-effect import: the standalone host page
//     (`standalone/client/index.html`) inlines equivalent container CSS.
//
// NOTE: this file must NOT import `../styles.css` — that file does not
// exist in the shim.

import { QueryClient } from "@tanstack/react-query";
import { createElement } from "react";

/** Marker string so a built bundle can be proven to use this shim. */
export const STANDALONE_SHIM_MARKER = "space-sdk-shim/1.0";

// Keep the marker in the minified bundle even if nothing imports the
// export: the assignment below is a side effect the bundler must keep.
if (typeof globalThis !== "undefined") {
  globalThis.__standaloneShim = STANDALONE_SHIM_MARKER;
}

/**
 * Error thrown by a {@link createActionClient} call when the server returns
 * a non-OK HTTP response. Carries the HTTP `status` so the retry policy can
 * tell a permanent client error (4xx) apart from retryable failures, and
 * the server's `Retry-After` (when present) as `retryAfterMs`.
 */
export class SpaceActionError extends Error {
  status;
  retryAfterMs;
  retrySafe;
  code;
  constructor(message, status, retryAfterMs, retrySafe = false, code) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.retrySafe = retrySafe;
    this.code = code;
    this.name = "SpaceActionError";
  }
}

// Actions can write even when invoked by useQuery. A failed connection or
// gateway response cannot prove that the handler did not commit a write.
export const PERMANENT_ACTION_STATUSES = new Set([
  400, 401, 403, 404, 409, 413, 415, 422,
]);

/** Retries after the first failure for a retryable action error. */
export const MAX_ACTION_RETRIES = 3;

const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;

/**
 * Default retry predicate for Space action queries, used by
 * {@link spaceQueryClient}. Retry only explicit pre-invocation failures,
 * with bounded backoff. Per-query overrides must preserve this outcome boundary.
 */
export function shouldRetryAction(failureCount, error) {
  if (
    error instanceof SpaceActionError &&
    PERMANENT_ACTION_STATUSES.has(error.status)
  ) {
    return false;
  }
  return (
    error instanceof SpaceActionError &&
    error.retrySafe &&
    failureCount < MAX_ACTION_RETRIES
  );
}

/**
 * Retry delay for Space action queries: exponential backoff with full jitter,
 * honoring the server's `Retry-After` (carried on {@link SpaceActionError})
 * as a floor. `failureCount` is the number of prior failures (0 before the
 * first retry).
 */
export function actionRetryDelay(failureCount, error) {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** failureCount);
  const floor =
    error instanceof SpaceActionError && error.retryAfterMs != null
      ? Math.min(RETRY_CAP_MS, Math.max(0, error.retryAfterMs))
      : 0;
  // Wait at least as long as the server asked, then add full jitter on top.
  return floor + Math.random() * ceiling;
}

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
export const spaceQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryAction,
      retryDelay: actionRetryDelay,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------------------
// Safe-area scrim (matches the real SDK's `dist/client/safe-area.js`).
// ---------------------------------------------------------------------------

const TOP_SAFE_AREA_SCRIM_HEIGHT =
  "calc(var(--twsa-safe-area-inset-top) + min(2rem, var(--twsa-safe-area-inset-top)))";
const TOP_SAFE_AREA_INSET_HEIGHT = "var(--twsa-safe-area-inset-top)";
const TOP_SAFE_AREA_GRADIENT_MASK =
  "linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, rgba(0, 0, 0, 0.99) 10%, rgba(0, 0, 0, 0.96) 20%, rgba(0, 0, 0, 0.90) 30%, rgba(0, 0, 0, 0.80) 40%, rgba(0, 0, 0, 0.67) 50%, rgba(0, 0, 0, 0.52) 60%, rgba(0, 0, 0, 0.36) 70%, rgba(0, 0, 0, 0.20) 80%, rgba(0, 0, 0, 0.08) 90%, rgba(0, 0, 0, 0) 100%)";

/**
 * Fixed top safe-area protection for Spaces without a top-extending header.
 *
 * It covers the device status-bar inset and, for the default gradient, adds
 * a small fade whose height collapses to zero on desktop. Use `className`,
 * `backgroundColor`, or non-layout `style` values for visual customization;
 * the component intentionally controls the fragile safe-area geometry.
 */
export function SafeAreaTopScrim({
  variant = "gradient",
  backgroundColor,
  zIndex = 40,
  className,
  style,
  ...props
}) {
  const resolvedBackgroundColor =
    backgroundColor ?? style?.backgroundColor ?? "var(--bg)";
  const managedStyle = {
    ...style,
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex,
    pointerEvents: "none",
    height:
      variant === "gradient"
        ? TOP_SAFE_AREA_SCRIM_HEIGHT
        : TOP_SAFE_AREA_INSET_HEIGHT,
    backgroundColor: resolvedBackgroundColor,
  };
  if (variant === "gradient") {
    managedStyle.maskImage = TOP_SAFE_AREA_GRADIENT_MASK;
    managedStyle.WebkitMaskImage = TOP_SAFE_AREA_GRADIENT_MASK;
  } else if (variant === "blur") {
    managedStyle.backdropFilter = style?.backdropFilter ?? "blur(12px)";
    managedStyle.WebkitBackdropFilter =
      style?.WebkitBackdropFilter ?? "blur(12px)";
  }
  return createElement("div", {
    ...props,
    "aria-hidden": props["aria-hidden"] ?? true,
    className,
    style: managedStyle,
  });
}

// ---------------------------------------------------------------------------
// Viewer stubs. Standalone has no host Muse, so there is no viewer context.
// ---------------------------------------------------------------------------

/**
 * Who is viewing this Space. Null when the Space has no viewer context,
 * such as a public share link or — as here — the standalone build.
 */
export function getSpaceViewer() {
  return Promise.resolve(null);
}

/**
 * Follow the viewer context while the page is visible. Standalone: no
 * viewer events ever arrive; returns an unsubscribe no-op.
 */
export function subscribeSpaceViewer(_listener) {
  return () => {};
}

/** React hook form of {@link subscribeSpaceViewer}: always null standalone. */
export function useSpaceViewer() {
  return null;
}

// ---------------------------------------------------------------------------
// Base64 helpers (matches the real SDK's `dist/client/file-encoding.js`).
// ---------------------------------------------------------------------------

/**
 * Base64-encode raw bytes. Uses the engine's native
 * `Uint8Array.prototype.toBase64` when present; older engines fall back to
 * building the intermediate binary string in bounded 32 KB chunks and
 * encoding once with `btoa`.
 */
export function bytesToBase64(bytes) {
  const native = bytes;
  if (typeof native.toBase64 === "function") {
    return native.toBase64();
  }
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Read a browser `File`/`Blob` into the `{ dataBase64, mimeType }` shape.
 */
export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    dataBase64: bytesToBase64(bytes),
    mimeType: file.type || "application/octet-stream",
  };
}

// ---------------------------------------------------------------------------
// Typed action client (matches the real SDK's `dist/client.js`).
// ---------------------------------------------------------------------------

const DEFAULT_ENDPOINT = "./actions";

function resolveEndpoint(relative) {
  const href = globalThis.location?.href;
  if (typeof href !== "string" || href.length === 0) {
    return relative;
  }
  const base = new URL(href);
  base.hash = "";
  base.search = "";
  return new URL(relative, base).toString();
}

function createActionCallId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `space-action-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function isActionRetrySafe(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    "retrySafe" in body &&
    body.retrySafe === true
  );
}

function actionErrorCode(body) {
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  if ("code" in body && typeof body.code === "string") {
    return body.code;
  }
  return undefined;
}

// A shown refusal keeps the host's own sentence; any other failure names
// the action, status, and body.
function actionFailureMessage(name, failure, status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  return `action ${name} ${failure}: ${status} ${text}`;
}

// Parse a `Retry-After` response header (RFC 7231 delta-seconds or
// HTTP-date) into milliseconds-from-now. Returns undefined when
// absent/unparseable.
function parseRetryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (raw == null) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return undefined;
}

async function readActionErrorBody(response) {
  const text = await response.text();
  if (text.length === 0) {
    return "";
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createActionClient(options = {}) {
  const endpoint = options.endpoint ?? resolveEndpoint(DEFAULT_ENDPOINT);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const callAction = (action, args, actionEndpoint, actionCallId) =>
    fetchImpl(actionEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Belt-and-suspenders request correlation: the daemon falls back to
        // the body `actionCallId`, but we still send it for environments
        // that preserve it.
        "x-request-id": actionCallId,
      },
      body: JSON.stringify({
        action,
        args: args ?? {},
        actionCallId,
      }),
    });

  const readActionData = async (response, name) => {
    const body = await response.json();
    if (body && typeof body === "object" && "error" in body && body.error) {
      throw new Error(`action ${name} error: ${String(body.error)}`);
    }
    return body.data;
  };

  return new Proxy(
    {},
    {
      get(_target, name) {
        // Symbol keys (Symbol.toPrimitive, Symbol.iterator, etc.) and
        // promise-protocol property names (then/catch/finally) must NOT
        // resolve to a phantom action. If `then` returned a function, any
        // accidental `await client` or `Promise.resolve(client)` would
        // see a thenable and call our function with (resolve, reject) as
        // its args — firing a network POST to a non-existent action named
        // "then".
        if (typeof name !== "string") {
          return undefined;
        }
        if (name === "then" || name === "catch" || name === "finally") {
          return undefined;
        }
        return async (args) => {
          const actionCallId = createActionCallId();
          const response = await callAction(name, args, endpoint, actionCallId);
          if (!response.ok) {
            const body = await readActionErrorBody(response);
            throw new SpaceActionError(
              actionFailureMessage(name, "failed", response.status, body),
              response.status,
              parseRetryAfterMs(response),
              isActionRetrySafe(body),
              actionErrorCode(body),
            );
          }
          return readActionData(response, name);
        };
      },
    },
  );
}
