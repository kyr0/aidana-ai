import { getRpcClient as getRpcClientBase } from "defuss-rpc/client.js";
import type { RpcApi } from "../../rpc";

export async function getRpcClient() {
  // Derive RPC URL from current page URL (RPC runs on chatPort + 100)
  const rawPort = window.location.port;
  const pagePort = rawPort ? Number(rawPort) : 8015;
  const rpcPort = Number.isFinite(pagePort) ? pagePort + 100 : 8115;
  const baseUrl = `http://localhost:${rpcPort}`;
  return getRpcClientBase<RpcApi>({ baseUrl });
}
