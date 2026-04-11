// ChatGPT Content Script
const log = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.log(tag, ...args) : console.log(`[${tag}]`, ...args);
const logError = (tag, ...args) => window.RemoteLogger ? window.RemoteLogger.error(tag, ...args) : console.error(`[${tag}]`, ...args);

log('ChatGPT', 'Content Script Loaded');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXECUTE_CHATGPT') {
        log('ChatGPT', 'Executing request', request.data);
        executeChatGPT(request.data, sendResponse);
        return true; // Async response
    }
});

async function executeChatGPT(data, sendResponse) {
    try {
        const { prompt } = data;
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        // Helper to wait for element
        const waitForElement = (selector, timeout = 10000) => {
            return new Promise((resolve, reject) => {
                if (document.querySelector(selector)) return resolve(document.querySelector(selector));

                const observer = new MutationObserver(() => {
                    if (document.querySelector(selector)) {
                        observer.disconnect();
                        resolve(document.querySelector(selector));
                    }
                });

                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Element ${selector} not found`));
                }, timeout);
            });
        };

        // 0. Check for Login (wait briefly to see if login button appears)
        // If we are on the login page, the input won't be found anyway, but let's check specifically.
        if (document.querySelector('button[data-testid="login-button"]')) {
            throw new Error('Not logged in to ChatGPT');
        }

        // 1. Find Input (Wait for it)
        const inputSelector = '#prompt-textarea';
        log('ChatGPT', 'Waiting for input...');
        const input = await waitForElement(inputSelector, 15000);

        // 2. Type Prompt
        log('ChatGPT', 'Focusing input...');
        input.focus();
        input.click(); // Simulate click
        await sleep(200);

        log('ChatGPT', 'Typing prompt...');
        input.innerHTML = ''; // Clear
        document.execCommand('insertText', false, prompt);
        await sleep(500);

        // 3. Click Send
        const sendButtonSelector = 'button[data-testid="send-button"]';
        log('ChatGPT', 'Waiting for send button...');
        const sendBtn = await waitForElement(sendButtonSelector, 5000);

        if (sendBtn.disabled) {
            throw new Error('Send button is disabled');
        }

        sendBtn.click();
        log('ChatGPT', 'Sent message');

        // 4. Wait for Completion
        // Strategy: Wait for the "Stop" button to disappear AND the "Send" button to reappear.

        log('ChatGPT', 'Waiting for generation to complete...');
        await new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const stopBtn = document.querySelector('button[data-testid="stop-button"]');

                if (stopBtn) {
                    // Still generating
                    return;
                }

                if (document.querySelectorAll('[data-message-author-role="assistant"]').length > 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);

            // Timeout after 3 minutes (thinking models take time)
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('Timeout waiting for generation to complete'));
            }, 180000);
        });

        log('ChatGPT', 'Generation complete. Waiting for UI to settle...');
        await new Promise(r => requestAnimationFrame(r));

        log('ChatGPT', 'Response received');

        // 5. Extract Response
        // Find all assistant messages
        const assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]');
        if (assistantMessages.length === 0) throw new Error('No assistant messages found');

        const lastMessage = assistantMessages[assistantMessages.length - 1];
        const proseElement = lastMessage.querySelector('.markdown.prose');

        if (!proseElement) throw new Error('No prose element found in last message');

        sendResponse({ success: true, result: proseElement.innerText });

    } catch (error) {
        logError('ChatGPT', 'Error:', error);
        sendResponse({ success: false, error: error.message });
    }
}
