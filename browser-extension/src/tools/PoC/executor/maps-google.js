self.MapsGoogleExecutor = class MapsGoogleExecutor extends self.BaseExecutor {
    constructor() {
        super('maps.google.com');
    }

    async execute(data) {
        const { query } = data;
        if (!query) {
            throw new Error('Query is required for MapsGoogleExecutor');
        }

        console.log('MapsGoogleExecutor: Executing with query', query);

        // 1. Create/Open Tab
        const tab = await this.createTab('https://maps.google.com');
        console.log('MapsGoogleExecutor: Tab created', tab.id);

        // 2. Send Message to Content Script
        try {
            const result = await this.sendMessageToTab(tab.id, 'EXECUTE_MAPS_GOOGLE', { query });
            console.log('MapsGoogleExecutor: Result received', result);
            return result;
        } catch (error) {
            console.error('MapsGoogleExecutor: Error executing', error);
            throw error;
        } finally {
            // Optional: Close tab after execution? 
            // Usually for tools we might want to keep it open or close it depending on preference.
            // For now, let's keep it open for debugging or close it if we want to be clean.
            // The user didn't specify, but usually automation tools close their tabs.
            // However, debugging is easier if it stays open. Let's leave it open for now or close it?
            // BaseExecutor has closeTab.
            await this.closeTab(tab.id);
        }
    }
}

Registry.registerTool('maps.google.com', MapsGoogleExecutor);
