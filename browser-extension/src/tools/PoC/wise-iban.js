// Wise IBAN Checker Content Script
const log = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.log(tag, ...args) : console.log(`[${tag}]`, ...args);
const logError = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.error(tag, ...args) : console.error(`[${tag}]`, ...args);

log('WiseIban', 'Content Script Loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_WISE_IBAN') {
        log('WiseIban', 'Executing request', request.data);
        executeWiseIban(request.data, sendResponse);
        return true; // Async response
    }
    if (request.action === 'EXTRACT_WISE_IBAN') {
        log('WiseIban', 'Extracting results');
        extractWiseIban(sendResponse);
        return true;
    }
});

async function extractWiseIban(sendResponse) {
    try {
        const successSelector = '.bank-card h3';
        const errorSelector = '.alert.alert-detach.alert-danger';

        // Wait for either success or error
        const waitForResult = (timeout = 2000) => {
            return new Promise((resolve) => {
                const startTime = Date.now();

                const check = () => {
                    const successEl = document.querySelector(successSelector);
                    if (successEl) return resolve({ type: 'success', el: successEl });

                    const errorEl = document.querySelector(errorSelector);
                    if (errorEl) return resolve({ type: 'error', el: errorEl });

                    if (Date.now() - startTime > timeout) {
                        return resolve(null);
                    }

                    requestAnimationFrame(check);
                };

                check();
            });
        };

        const result = await waitForResult(5000);

        if (result) {
            if (result.type === 'success') {
                const card = result.el.closest('.bank-card');
                // Check if it has the "Valid IBAN details" text or similar
                if (card && card.innerText.includes("Valid IBAN details")) {
                    const html = card.outerHTML;
                    sendResponse({ success: true, result: { html } });
                } else {
                    sendResponse({ success: false, error: 'Result card found but content mismatch' });
                }
            } else if (result.type === 'error') {
                const errorText = result.el.innerText;
                sendResponse({ success: true, result: { error: errorText } });
            }
        } else {
            sendResponse({ success: false, error: 'No result found (timeout)' });
        }
    } catch (e) {
        sendResponse({ success: false, error: e.message });
    }
}

async function executeWiseIban(data, sendResponse) {
    try {
        const { iban } = data;

        if (!iban) {
            throw new Error('IBAN is required');
        }

        // Helper to wait for element
        // Helper to wait for element
        const waitForSelector = (selector, timeout = 1000) => {
            return new Promise((resolve) => {
                const startTime = Date.now();
                const check = () => {
                    const el = document.querySelector(selector);
                    if (el) return resolve(el);

                    if (Date.now() - startTime > timeout) {
                        return resolve(null);
                    }
                    requestAnimationFrame(check);
                };
                check();
            });
        };

        // 1. Find and fill input
        const inputSelector = '#iban-number';
        const input = await waitForSelector(inputSelector);
        if (!input) throw new Error('IBAN input not found');

        log('WiseIban', 'Found input, typing IBAN...');
        input.focus();
        input.value = iban;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // 2. Click button
        const buttonSelector = '#checker-card-cta';
        const button = await waitForSelector(buttonSelector);
        if (!button) throw new Error('Check button not found');

        log('WiseIban', 'Clicking check button...');
        button.click();

        // 3. Wait for results
        // The page might reload or update dynamically. 
        // The user mentioned "This will submit a form and the page will reload."
        // If the page reloads, this content script will be re-injected.
        // However, if we are in a single page app or if the reload is fast, we might lose context.
        // But usually, if the page reloads, the background script needs to handle re-injection or we need to persist state.
        // BUT, if the tool execution waits for the tab to load, and then sends the message, that's for the initial load.
        // If the action causes a reload, we might need a way to capture the result after reload.

        // Let's assume for a moment it might be an SPA update OR we need to handle the reload.
        // If it's a full reload, the `sendResponse` won't work across reloads.
        // However, looking at the Wise IBAN checker, it often updates in-place or is an SPA.
        // If it IS a full reload, we have a problem with the standard `sendMessageToTab` pattern which expects a response from the SAME script instance.

        // Strategy: Wait for the result element. If it appears, great.
        // If the page unloads, we might fail.
        // Let's try waiting for the result element first.

        // 3. Wait for results
        log('WiseIban', 'Waiting for results...');

        // We don't wait here anymore because we expect a reload or we handle it in extract.
        // But if it's an SPA update, we might want to check briefly.
        // However, the user specifically asked to speed up and not wait arbitrarily.
        // And the executor handles the reload catch.

        // If we return immediately, the executor might think it's done.
        // But we need to return something.
        // If we return success, the executor finishes.
        // But we want the executor to catch the reload.

        // If we wait for a selector that WON'T appear because of reload, we time out.
        // If we wait for a selector that MIGHT appear (SPA), we are good.

        // Let's just wait for a short moment for the button click to register and potential reload to start.
        // Or we can try to wait for the result using the same logic as extract, but with a short timeout?
        // If the page reloads, this promise will never resolve (connection lost), which triggers the catch in executor.
        // So waiting for a result that appears is fine.

        const successSelector = '.bank-card h3';
        const errorSelector = '.alert.alert-detach.alert-danger';

        const waitForResult = (timeout = 1000) => {
            return new Promise((resolve) => {
                const startTime = Date.now();
                const check = () => {
                    if (document.querySelector(successSelector)) return resolve(true);
                    if (document.querySelector(errorSelector)) return resolve(true);

                    if (Date.now() - startTime > timeout) {
                        return resolve(false);
                    }
                    requestAnimationFrame(check);
                };
                check();
            });
        };

        // We wait briefly. If reload happens, we die (good). If SPA happens, we find it.
        const found = await waitForResult(2000);

        if (found) {
            // If found without reload, we can extract immediately!
            // Reuse extract logic? Or just tell executor we found it?
            // If we return success, executor finishes.
            // Let's try to extract.
            // But we need to be careful about duplication.
            // For now, let's just return and let the executor decide if it needs to extract.
            // Actually, if we return success, the executor returns that result.
            // So we should extract here if possible.

            // ... But to keep it simple and robust as per user request (race it), let's just return success
            // and let the executor call extract if it wants?
            // No, the executor only calls extract if it catches an error (reload).
            // So if we find it here (SPA), we MUST return the result.

            const successEl = document.querySelector(successSelector);
            if (successEl) {
                const card = successEl.closest('.bank-card');
                if (card) {
                    sendResponse({ success: true, result: { html: card.outerHTML } });
                    return;
                }
            }

            const errorEl = document.querySelector(errorSelector);
            if (errorEl) {
                sendResponse({ success: true, result: { error: errorEl.innerText } });
                return;
            }
        }

        // If not found and no reload happened yet (timeout), we send response.
        // But likely reload happens.
        log('WiseIban', 'No result found yet (waiting for reload?)');
        // We don't send response, we let it timeout or fail on reload.
        // But we need to keep the connection open?
        // If we return true in listener, we keep it open.
        // If we don't sendResponse, the executor waits until timeout.
        // If reload happens, executor catches error.

        // So we just do nothing here and let the reload kill us.
        // But if reload DOESN'T happen (e.g. button click failed), we should probably timeout.
        // The waitForResult has a timeout.

        // Let's send a "pending" or just let it be.
        // If we send success: false, executor throws.
        // If we don't send, executor waits.

        // Let's try to send response if we timed out waiting for result/reload.
        if (!found) {
            // Maybe wait a bit more?
            // User said "not wait arbitrarily".
            // If 2s passed and no result and no reload, maybe something is wrong.
            sendResponse({ success: false, error: 'Timeout waiting for result or reload' });
        }



    } catch (error) {
        logError('WiseIban', 'Error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Check on load if we already have a result? 
// If the executor loads the page with a query param, maybe?
// Wise URL structure: /gb/iban/checker
// Does it accept query params? e.g. ?iban=...
// If so, we could just navigate to that URL.
// But the user instruction was to type and click.

