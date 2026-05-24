/**
 * Content-script tool registrations.
 *
 * Import this module once (e.g. from tab-rpc.ts) to make all
 * content-script-side tools available via the tool registry.
 */
import { registerContentScriptTool } from "./lib/content-script/tool-registry";
import { GoogleSearchContentScriptTool } from "./tools/google-search";
import { ArztSucheContentScriptTool } from "./tools/116117-arztsuche";
import { ScrapeContentScriptTool } from "./tools/scrape";
import { DownloadFileContentScriptTool } from "./tools/download-file";
import { ChatGPTSendContentScriptTool, ChatGPTExtractContentScriptTool } from "./tools/chatgpt";
import { GoogleMapsSendContentScriptTool, GoogleMapsExtractContentScriptTool } from "./tools/google-maps";
import { ConsensusSendContentScriptTool, ConsensusExtractContentScriptTool } from "./tools/consensus";

registerContentScriptTool(GoogleSearchContentScriptTool);
registerContentScriptTool(GoogleMapsSendContentScriptTool);
registerContentScriptTool(GoogleMapsExtractContentScriptTool);
registerContentScriptTool(ArztSucheContentScriptTool);
registerContentScriptTool(ScrapeContentScriptTool);
registerContentScriptTool(DownloadFileContentScriptTool);
registerContentScriptTool(ChatGPTSendContentScriptTool);
registerContentScriptTool(ChatGPTExtractContentScriptTool);
registerContentScriptTool(ConsensusSendContentScriptTool);
registerContentScriptTool(ConsensusExtractContentScriptTool);
