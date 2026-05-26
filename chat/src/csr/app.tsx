import { Redirect, Route, Router, RouterSlot } from "defuss";
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
import type { User } from "../models/user";

// Initialize i18n
initI18n();

// Restore persisted state
const settings = loadSettingsFromStorage();
chatStore.set({ ...chatStore.value, settings });
loadConversationsFromStorage();

// Restore existing session from sessionStorage synchronously (before any render)
if (!window.$APP_PROPS) {
	window.$APP_PROPS = { user: null, token: null };
}
const storedToken = sessionStorage.getItem("auth_token");
const storedUser = sessionStorage.getItem("auth_user");
if (storedToken && storedUser) {
	try {
		window.$APP_PROPS.token = storedToken;
		window.$APP_PROPS.user = JSON.parse(storedUser) as User;
	} catch {
		// Ignore corrupted data
	}
}

// Parse URL query parameters for auto-login
function parseAutoLoginParams(): { username?: string; password?: string } {
	const params = new URLSearchParams(window.location.search);
	const username = params.get("username") || undefined;
	const password = params.get("password") || undefined;
	return { username, password };
}

// Perform auto-login and set up app state
async function performAutoLogin(username: string, password: string): Promise<boolean> {
	try {
		const rpc = await getRpcClient();
		const authApi = new rpc.AuthApi();
		const result = await authApi.login(username, password);

		if (result.success && result.token && result.user) {
			if (!window.$APP_PROPS) {
				window.$APP_PROPS = { user: null, token: null };
			}
			window.$APP_PROPS.user = result.user;
			window.$APP_PROPS.token = result.token;
			sessionStorage.setItem("auth_token", result.token);
			sessionStorage.setItem("auth_user", JSON.stringify(result.user));

			// Clean URL by removing auth parameters after successful login
			const url = new URL(window.location.href);
			url.searchParams.delete("username");
			url.searchParams.delete("password");
			window.history.replaceState({}, "", url.toString());

			return true;
		}
		return false;
	} catch (err) {
		console.warn("[Chat] Auto-login failed:", err);
		return false;
	}
}

// Promise that resolves when initial auto-login setup is complete
let autoLoginReady = false;
const autoLoginPromise = (async () => {
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

		// Skip auto-login if already restored from session
		if (window.$APP_PROPS?.user) {
			console.log("[Chat] Session restored from sessionStorage");
			autoLoginReady = true;
			return;
		}

		// Check for URL-based auto-login first (takes priority)
		const urlParams = parseAutoLoginParams();
		if (urlParams.username && urlParams.password) {
			const loginSuccess = await performAutoLogin(urlParams.username, urlParams.password);
			if (loginSuccess) {
				console.log("[Chat] Auto-login successful via URL parameters");
				autoLoginReady = true;
				Router.navigate("/chat");
				return;
			}
		}

		// Fall back to auto-login with proxy admin credentials from config
		if (llmConfig.adminUser && llmConfig.adminPassword) {
			const loginSuccess = await performAutoLogin(llmConfig.adminUser, llmConfig.adminPassword);
			if (loginSuccess) {
				console.log("[Chat] Auto-login successful via config credentials");
				autoLoginReady = true;
				Router.navigate("/chat");
				return;
			}
		}
	} catch (err) {
		console.warn("[Chat] Could not fetch LLM config via RPC, using defaults:", err);
	}
	autoLoginReady = true;
})();

export function RouterOutlet() {
	const isLoggedIn = !!window.$APP_PROPS?.user;
	const hasUrlParams = parseAutoLoginParams().username && parseAutoLoginParams().password;

	// While auto-login is in progress (URL params present but not yet logged in),
	// don't render routes - wait for the async login to complete
	if (!autoLoginReady && hasUrlParams && !isLoggedIn) {
		return <div />;
	}

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
