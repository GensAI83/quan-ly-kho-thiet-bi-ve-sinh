import type { Actions } from "../../server/src/actions";
import type { ActionClient } from "../../server/src/local-contract";

export type ApiRequest<C, K extends keyof C> = C[K] extends (args: infer A) => unknown ? A : never;
export type ApiResponse<C, K extends keyof C> = C[K] extends (...args: any[]) => infer R ? Awaited<R> : never;

export const api = new Proxy({}, {
  get(_target, action: string) {
    return async (args: unknown) => {
      const response = await fetch("/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, args }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không kết nối được ứng dụng.");
      return data;
    };
  },
}) as ActionClient<typeof Actions>;
