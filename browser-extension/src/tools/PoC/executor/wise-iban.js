self.WiseIbanExecutor = class WiseIbanExecutor extends self.BaseExecutor {
    constructor() {
        super('wise.com');
    }

    async execute(data) {
        const { iban } = data;
        if (!iban) {
            throw new Error('IBAN is required for WiseIbanExecutor');
        }

        console.log('WiseIbanExecutor: Executing with IBAN', iban);

        // 1. Create/Open Tab
        const tab = await this.createTab('https://wise.com/gb/iban/checker');
        console.log('WiseIbanExecutor: Tab created', tab.id);

        try {
            // 2. Send Message to Content Script to Execute
            // This might fail if the page reloads immediately after click
            console.log('WiseIbanExecutor: Sending EXECUTE_WISE_IBAN');
            const result = await this.sendMessageToTab(tab.id, 'EXECUTE_WISE_IBAN', { iban });

            console.log('WiseIbanExecutor: Result received directly', result);
            return result;

        } catch (error) {
            console.warn('WiseIbanExecutor: Initial execution failed or page reloaded', error.message);

            // Assume any error during the initial execution might be due to the page reloading
            // especially "message port closed" or "connection lost"
            // But even if it's a timeout, it might be because the page started reloading.

            console.log('WiseIbanExecutor: Attempting to recover/wait for reload...');

            try {
                // Wait for tab to be ready again
                await this.waitForTabLoad(tab.id);

                // Poll for content script readiness instead of sleeping
                // We try to send the message. If it fails, we retry.
                console.log('WiseIbanExecutor: Polling for content script...');

                let attempts = 0;
                while (attempts < 10) {
                    try {
                        console.log('WiseIbanExecutor: Sending EXTRACT_WISE_IBAN attempt', attempts + 1);
                        const result = await this.sendMessageToTab(tab.id, 'EXTRACT_WISE_IBAN', {});
                        console.log('WiseIbanExecutor: Result received after reload', result);
                        return result;
                    } catch (e) {
                        // If connection failed, wait briefly and retry
                        // We use a short timeout here as we are in Node.js environment
                        await new Promise(resolve => setTimeout(resolve, 200));
                        attempts++;
                    }
                }
                throw new Error('Failed to extract after reload (timeout)');
            } catch (retryError) {
                console.error('WiseIbanExecutor: Recovery failed', retryError);
                throw retryError;
            }
        } finally {
            await this.closeTab(tab.id);
        }
    }
}

Registry.registerTool('iban-check', WiseIbanExecutor);
