self.LinkedInExecutor = class LinkedInExecutor extends self.BaseExecutor {
    constructor() {
        super('linkedin:get_posts');
    }

    async waitForContentScript(tabId) {
        const maxAttempts = 20;
        const interval = 500; // 500ms

        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await this.sendMessageToTab(tabId, 'ping', {});
                if (response && response.message === 'pong') {
                    console.log(`[LinkedInExecutor] Content script ready after ${i * interval}ms`);
                    return true;
                }
            } catch (e) {
                // Ignore errors, script might not be ready
            }
            await new Promise(r => setTimeout(r, interval));
        }
        throw new Error('Content script failed to load within timeout');
    }

    async execute(toolData) {
        let url = toolData.url;
        if (!url) {
            throw new Error('URL is required for linkedin:get_posts tool');
        }

        // Normalize URL to ensure we land on the posts/activity page
        // This ensures content-activity.js is loaded
        if (url.includes('/in/') && !url.includes('/recent-activity/')) {
            url = url.replace(/\/$/, '') + '/recent-activity/all/';
        } else if ((url.includes('/company/') || url.includes('/showcase/')) && !url.includes('/posts/')) {
            url = url.replace(/\/$/, '') + '/posts/?feedView=all';
        }

        console.log(`[LinkedInExecutor] Navigating to ${url}`);
        const tab = await this.createTab(url);

        let executionError = null;
        try {
            // Wait for content script to be ready using ping
            console.log(`[LinkedInExecutor] Waiting for content script on tab ${tab.id}`);
            await this.waitForContentScript(tab.id);

            console.log(`[LinkedInExecutor] Sending getActivityData to tab ${tab.id}`);

            let response;
            let attempts = 0;
            const maxAttempts = 3; // Reduced retries since we already waited for ping
            const topK = toolData.topK || 3;

            while (attempts < maxAttempts) {
                try {
                    response = await this.sendMessageToTab(tab.id, 'getActivityData', { topK });
                    break;
                } catch (e) {
                    attempts++;
                    console.log(`[LinkedInExecutor] Attempt ${attempts} failed: ${e.message}`);
                    if (attempts === maxAttempts) throw e;
                    await new Promise(r => setTimeout(r, 1000));
                }
            }

            if (response && response.requiresLogin) {
                throw new Error('Not logged in to LinkedIn. Please log in to the opened tab and try again.');
            }

            return response;
        } catch (error) {
            executionError = error;
            console.error('[LinkedInExecutor] Error executing tool:', error);
            throw error;
        } finally {
            // Don't close the tab if login is required, so the user can log in
            if (!executionError || !executionError.message.includes('Not logged in')) {
                await this.closeTab(tab.id);
            }
        }
    }
}

Registry.registerTool('linkedin:get_posts', LinkedInExecutor);
