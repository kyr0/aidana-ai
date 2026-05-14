/** Shared utilities for content-script-side tool implementations */

/** Wait for at least one of the given selectors to appear in the DOM */
export function waitForSelector(
  selectors: string[],
  timeoutMs = 10_000,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const check = (): Element | null => {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el) return el;
      }
      return null;
    };

    // Initial check
    const found = check();
    if (found) {
      resolve(found);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = check();
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Try to find and click a cookie-consent button on the page.
 * Searches the main document and all same-origin iframes for <button>
 * elements whose title attribute or text content contains "Accept",
 * "Zustimmen", or "Einwilligen". Also matches common cookie-banner
 * classes like "modalBtnAccept".
 *
 * Returns immediately if no button is found within `timeoutMs` (default 1s).
 */
export async function acceptCookieBanner(timeoutMs = 1_000): Promise<boolean> {
  const cookieButtonSelectors = [
    // Common class selectors
    'button.modalBtnAccept',
    // Buttons with cookie-consent keywords in title
    'button[title*="Accept"]',
    'button[title*="Zustimmen"]',
    'button[title*="Einwilligen"]',
  ];
  const acceptKeywords = ["accept", "zustimmen", "einwilligen"];

  // Helper: scan a single document for matching buttons
  function scanDocument(doc: Document): HTMLElement | null {
    // Try known selectors first
    for (const s of cookieButtonSelectors) {
      const el = doc.querySelector(s);
      if (el instanceof HTMLElement) return el;
    }
    // Fallback: scan all buttons by text/title
    const allButtons = Array.from(doc.querySelectorAll("button"));
    for (const btn of allButtons) {
      const text = btn.textContent ?? "";
      const title = btn.getAttribute("title") ?? "";
      const combined = `${text} ${title}`.toLowerCase();
      if (acceptKeywords.some((kw) => combined.includes(kw))) {
        return btn as HTMLElement;
      }
    }
    return null;
  }

  // First try: wait for known selectors in the main document
  const found = await waitForSelector(cookieButtonSelectors, timeoutMs);
  if (found instanceof HTMLElement) {
    found.click();
    return true;
  }

  // Second try: scan main document by text/title
  const mainMatch = scanDocument(document);
  if (mainMatch) {
    mainMatch.click();
    return true;
  }

  // Third try: scan all same-origin iframes
  const iframes = Array.from(document.querySelectorAll("iframe"));
  for (const iframe of iframes) {
    try {
      // Cross-origin iframes will throw when accessing contentDocument
      const iframeDoc = iframe.contentDocument;
      if (iframeDoc) {
        const match = scanDocument(iframeDoc);
        if (match) {
          match.click();
          return true;
        }
      }
    } catch {
      // Cross-origin iframe — skip silently
    }
  }

  return false;
}

/** Send a border control message to the MAIN-world preload via postMessage */
function postBorderAction(action: string): void {
  console.log(`[defuss-tools] posting border action: ${action}`);
  window.postMessage({ __defuss: true, action }, "*");
}

/**
 * Signal the MAIN-world preload to show the automation border.
 * Returns a promise that resolves after a paint frame so the border
 * is visible before the caller continues (prevents show→hide race).
 */
export function showAutomationBorder(): Promise<void> {
  postBorderAction("border_show");
  // Wait for next animation frame + microtask so the browser paints the border
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

/** Signal the MAIN-world preload to hide the automation border */
export function hideAutomationBorder(): void {
  postBorderAction("border_hide");
}

/** Signal the MAIN-world preload to switch the border to error state */
export function showErrorBorder(): void {
  postBorderAction("border_error");
}

export interface WaitForDomStableOptions {
  /** CSS selector to scope observation to a subtree (default: entire document) */
  selector?: string;
  /** Duration in ms with zero mutations before the DOM is considered stable */
  quietPeriodMs?: number;
  /** Maximum time in ms to wait for stability before giving up */
  timeoutMs?: number;
  /** Internal polling interval in ms */
  checkIntervalMs?: number;
}

/**
 * Wait until the DOM is stable (no mutations for a quiet period).
 *
 * When `selector` is provided, a dedicated MutationObserver watches only
 * that subtree. Otherwise, listens to the whole-page
 * `__defuss_ext_dom_mutations` CustomEvent from the MAIN-world preload.
 */
export function waitForDomStable({
  selector,
  quietPeriodMs = 1_000,
  timeoutMs = 15_000,
  checkIntervalMs = 200,
}: WaitForDomStableOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let lastActivityTime = Date.now();
    let settled = false;

    let subtreeObserver: MutationObserver | undefined;
    let eventListener: EventListener | undefined;

    const target = selector ? document.querySelector(selector) : null;

    if (selector && !target) {
      // Element doesn't exist (yet) — resolve immediately
      resolve();
      return;
    }

    if (target) {
      // Scoped: observe only the selected subtree
      subtreeObserver = new MutationObserver((mutations) => {
        if (mutations.length > 0) {
          lastActivityTime = Date.now();
        }
      });
      subtreeObserver.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } else {
      // Whole-page: use the MAIN-world preload event
      eventListener = ((event: CustomEvent<{ count: number }>) => {
        if (event.detail.count > 0) {
          lastActivityTime = Date.now();
        }
      }) as EventListener;
      document.addEventListener("__defuss_ext_dom_mutations", eventListener);
    }

    const cleanup = () => {
      settled = true;
      subtreeObserver?.disconnect();
      if (eventListener) {
        document.removeEventListener(
          "__defuss_ext_dom_mutations",
          eventListener,
        );
      }
      clearInterval(checkInterval);
      clearTimeout(timeout);
    };

    const checkInterval = setInterval(() => {
      if (settled) return;
      if (Date.now() - lastActivityTime >= quietPeriodMs) {
        cleanup();
        resolve();
      }
    }, checkIntervalMs);

    const timeout = setTimeout(() => {
      if (settled) return;
      cleanup();
      reject(new Error(`DOM did not stabilise within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
