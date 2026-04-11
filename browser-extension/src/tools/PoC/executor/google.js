self.GoogleExecutor = class GoogleExecutor extends self.BaseExecutor {
    constructor() {
        super('google.com');
    }

    async execute(toolData) {
        const query = toolData.query;
        const topK = toolData.topK || 3;
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        const tab = await this.createTab(searchUrl);

        try {
            return await this.sendMessageToTab(tab.id, 'EXECUTE_GOOGLE', { query, topK });
        } finally {
            await this.closeTab(tab.id);
        }
    }
}

Registry.registerTool('google.com', GoogleExecutor);
