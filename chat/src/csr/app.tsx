import { Redirect, Route, RouterSlot } from "defuss";
import { LoginScreen } from "./screens/login";
import { ChatScreen } from "./screens/chat";
import { PreAuthLayout } from "./layouts/pre-auth";
import { AppLayout } from "./layouts/app-layout";
import {
	chatStore,
	loadConversationsFromStorage,
	loadSettingsFromStorage,
	saveSettingsToStorage,
} from "./lib/chat-store";
import { getRpcClient } from "./lib/rpc-client";
import { initI18n } from "./i18n";

// Initialize i18n
initI18n();

// Restore persisted state
const settings = loadSettingsFromStorage();
chatStore.set({ ...chatStore.value, settings });
loadConversationsFromStorage();

// Fetch LLM config from Aidana via RPC and apply to chat settings
(async () => {
	try {
		const rpc = await getRpcClient();
		const configApi = new rpc.ConfigApi();
		const llmConfig = await configApi.getLlmConfig();

		const updatedSettings = {
			...chatStore.value.settings,
			baseUrl: llmConfig.baseUrl,
			apiKey: llmConfig.apiKey || "",
			model: llmConfig.model || chatStore.value.settings.model,
		};
		chatStore.set({ ...chatStore.value, settings: updatedSettings });
		saveSettingsToStorage(updatedSettings);

		// Auto-login with proxy admin credentials
		if (llmConfig.adminUser && llmConfig.adminPassword && !window.$APP_PROPS?.user) {
			const authApi = new rpc.AuthApi();
			const result = await authApi.login(llmConfig.adminUser, llmConfig.adminPassword);
			if (result.success && result.token && result.user) {
				if (!window.$APP_PROPS) {
					window.$APP_PROPS = { user: null, token: null };
				}
				window.$APP_PROPS.user = result.user;
				window.$APP_PROPS.token = result.token;
				sessionStorage.setItem("auth_token", result.token);
				sessionStorage.setItem("auth_user", JSON.stringify(result.user));
			}
		}
	} catch (err) {
		console.warn("[Chat] Could not fetch LLM config via RPC, using defaults:", err);
	}
})();

export function RouterOutlet() {
	const isLoggedIn = !!window.$APP_PROPS?.user;

	return (
		<>
			{isLoggedIn && <Redirect path="/" exact={true} to="/chat" />}

			<Route path="/" component={LoginRoute} />
			<Route path="/chat" component={ChatRoute} />

			{!isLoggedIn && <Redirect path="/chat" to="/" />}
		</>
	);
}

function LoginRoute() {
	return (
		<PreAuthLayout>
			<LoginScreen />
		</PreAuthLayout>
	);
}

function ChatRoute() {
	return (
		<AppLayout>
			<ChatScreen />
		</AppLayout>
	);
}

export function App() {
	return <RouterSlot tag="div" RouterOutlet={RouterOutlet} />;
}
