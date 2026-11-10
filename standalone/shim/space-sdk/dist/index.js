// Minimal standalone re-implementation of the SERVER side of
// `@hatch/space-sdk` (version 0.14.0 surface, as used by this app).
//
// This is NOT the full Muse SDK. It implements only what
// `server/src/actions.ts` uses: `z` (re-exported from zod), `defineAction`,
// `isAction`, `actionDescription`, and the `Ctx` / `ActionsModule` /
// `SpaceDb` types (see `dist/index.d.ts`). The behaviour matches the real
// SDK's `dist/server-contract.js`: `defineAction` returns a plain object
// carrying the `@hatch/space-sdk/action/v1` brand plus request/response
// schemas and the handler; `actionDescription` collapses whitespace and
// truncates to 300 characters.
//
// The standalone server (`standalone/server/index.ts`) is the dispatcher:
// it validates args against each action's `request` schema and calls the
// handler with `{ db: () => db, invalidateQueries: () => {} }`.

import { z } from "zod";

export { z };

export const ACTION_BRAND = "@hatch/space-sdk/action/v1";

/** Marker string so a built bundle can be proven to use this shim. */
export const STANDALONE_SHIM_MARKER = "space-sdk-shim/1.0";

const ACTION_DESCRIPTION_MAX_CHARS = 300;

/** Both runtimes list actions through this, so local and shared catalogs agree. */
export function actionDescription(definition) {
  const description = definition.description
    ?.replace(/[\s\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return description
    ? [...description].slice(0, ACTION_DESCRIPTION_MAX_CHARS).join("")
    : undefined;
}

/** Bind the shared action implementation to a runtime-specific Ctx type. */
export function createDefineAction() {
  return function defineAction(spec) {
    return {
      __brand: ACTION_BRAND,
      request: spec.request,
      response: spec.response,
      ...(spec.description !== undefined
        ? { description: spec.description }
        : {}),
      ...(spec.privileged !== undefined
        ? { privileged: spec.privileged }
        : {}),
      handler: spec.handler,
    };
  };
}

/** Define a single action. */
export const defineAction = createDefineAction();

/** Runtime check used by workers to filter module exports. */
export function isAction(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "__brand" in value &&
    value.__brand === ACTION_BRAND
  );
}
