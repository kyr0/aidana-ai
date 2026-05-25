import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * ConfigApi - Reads LLM configuration from ~/.aidana/config.json.
 *
 * This allows the chat UI to fetch its LLM settings directly from the
 * Aidana config without needing environment variables or .env files.
 */
export class ConfigApi {
  async getLlmConfig(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    proxyPort: number;
    adminUser: string;
    adminPassword: string;
  }> {
    const configPath = path.join(os.homedir(), ".aidana", "config.json");

    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      const llm = config.llm || {};
      const proxy = llm.proxy || {};

      const proxyPort = typeof proxy.port === "number" ? proxy.port : 8010;
      const adminUser = typeof proxy.admin_user === "string" ? proxy.admin_user : "admin";
      const adminPassword = typeof proxy.admin_password === "string" ? proxy.admin_password : "changeme";
      const apiKey = typeof llm.apiKey === "string" ? llm.apiKey : "";
      const model = typeof llm.model === "string" ? llm.model : "";

      const result = {
        baseUrl: `http://127.0.0.1:${proxyPort}/v1`,
        apiKey,
        model,
        proxyPort,
        adminUser,
        adminPassword,
      };
      console.log("[ConfigApi] getLlmConfig result:", JSON.stringify(result, null, 2));
      return result;
    } catch (err) {
      console.log("[ConfigApi] getLlmConfig error:", err);
      // Return defaults if config not found or invalid
      return {
        baseUrl: "http://127.0.0.1:8010/v1",
        apiKey: "",
        model: "",
        proxyPort: 8010,
        adminUser: "admin",
        adminPassword: "changeme",
      };
    }
  }
}
