import { z } from "zod";
import type { LocalDb } from "./local-database";

export { z };
export type SpaceDb<_Schema = unknown> = LocalDb;
export type ActionContext = { db: <T = unknown>() => SpaceDb<T>; invalidateQueries: () => void };
export type ActionsModule = Record<string, { description: string; request: z.ZodType; response: z.ZodType; handler: (ctx: ActionContext, args: any) => Promise<any> }>;

export function defineAction<Request extends z.ZodType, Response extends z.ZodType>(action: {
  description: string;
  request: Request;
  response: Response;
  handler: (ctx: ActionContext, args: z.output<Request>) => Promise<z.input<Response>>;
}) { return action; }

export type ActionClient<A extends ActionsModule> = {
  [K in keyof A]: (args: z.input<A[K]["request"]>) => Promise<z.output<A[K]["response"]>>;
};
