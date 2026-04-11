// Google Maps Content Script
const log = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.log(tag, ...args) : console.log(`[${tag}]`, ...args);
const logError = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.error(tag, ...args) : console.error(`[${tag}]`, ...args);

log('MapsGoogle', 'Content Script Loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_MAPS_GOOGLE') {
        log('MapsGoogle', 'Executing request', request.data);
        executeMapsGoogle(request.data, sendResponse);
        return true; // Async response
    }
});

async function executeMapsGoogle(data, sendResponse) {
    try {
        const { query } = data;

        if (!query) {
            throw new Error('Query is required');
        }

        // Helper to wait for element
        const waitForSelector = (selector, timeout = 10000) => {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) return resolve(element);

                const observer = new MutationObserver(() => {
                    const element = document.querySelector(selector);
                    if (element) {
                        observer.disconnect();
                        resolve(element);
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    resolve(null);
                }, timeout);
            });
        };

        // Helper to wait for stable results
        const waitForStableResults = (containerSelector, stabilityDuration = 500, maxWait = 5000) => {
            return new Promise((resolve) => {
                const container = document.querySelector(containerSelector);
                if (!container) return resolve(false);

                let timer;
                const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        observer.disconnect();
                        resolve(true);
                    }, stabilityDuration);
                });

                observer.observe(container, { childList: true, subtree: true });

                // Initial timer in case no mutations happen immediately
                timer = setTimeout(() => {
                    observer.disconnect();
                    resolve(true);
                }, stabilityDuration);

                // Max wait safety
                setTimeout(() => {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(true);
                }, maxWait);
            });
        };

        // 1. Find and interact with search box
        const searchInput = await waitForSelector('#searchboxinput');
        if (!searchInput) throw new Error('Search input not found');

        log('MapsGoogle', 'Found search input, typing query...');

        // Simulate user interaction
        searchInput.focus();
        searchInput.value = query;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));

        // 2. Click search button
        const searchButton = await waitForSelector('#searchbox-searchbutton');
        if (!searchButton) throw new Error('Search button not found');

        log('MapsGoogle', 'Clicking search button...');
        searchButton.click();

        // 3. Wait for results
        log('MapsGoogle', 'Waiting for results...');

        const mainSelector = '[role="main"]';
        const articleSelector = '[role="article"]';
        const combinedSelector = `${mainSelector} ${articleSelector}`;

        // Wait for at least one result to appear
        const firstResult = await waitForSelector(combinedSelector, 5000);

        if (!firstResult) {
            log('MapsGoogle', 'No list results found immediately');
            // It might be a direct place result or no results. 
            // If it's a direct place, the URL usually changes or a specific pane appears.
            // For now, we assume list results or fail gracefully.
        } else {
            log('MapsGoogle', 'First result found, waiting for stability...');
            // Wait for the list to stabilize (no new items added for a short period)
            await waitForStableResults(mainSelector, 500);
        }

        // Use requestAnimationFrame to ensure render
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 4. Extract results
        // Find all articles within main
        const allArticles = Array.from(document.querySelectorAll(combinedSelector));
        log('MapsGoogle', `Found ${allArticles.length} total articles`);

        // Filter for those with a direct child button
        const validArticles = allArticles.filter(article => {
            return Array.from(article.children).some(child => child.tagName === 'BUTTON');
        });
        log('MapsGoogle', `Found ${validArticles.length} valid articles (with direct child button)`);

        const poiNames = validArticles.map(el => {
            return el.innerText.split("\n")[0];
        }).filter(name => name && name.trim() !== '');

        log('MapsGoogle', 'Extracted names:', poiNames);

        sendResponse({ success: true, result: poiNames });

    } catch (error) {
        logError('MapsGoogle', 'Error:', error);
        sendResponse({ success: false, error: error.message });
    }
}
