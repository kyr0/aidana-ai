// Content script for extracting post data from LinkedIn recent activity pages and company posts pages
// This script handles data extraction from:
// - Activity feed pages (linkedin.com/in/*/recent-activity/*)
// - Company posts pages (linkedin.com/company/*/posts/*)

function log(message, level = 'info') {
  console.log(`[LinkedIn Content Script] ${message} `);
  try {
    chrome.runtime.sendMessage({
      action: 'log_entry',
      level: level,
      message: message,
      tag: 'linkedin',
      timestamp: Date.now()
    });
  } catch (e) {
    // Ignore errors if background script is not reachable
  }
}

log('Profile To minless: Activity LinkedIn content script loaded on: ' + window.location.href);

/**
 * Extracts all posts from the activity feed page
 * Handles both personal activity pages and company posts pages
 * @returns {Array} Array of post objects with extracted data
 */
function extractAllPosts() {
  try {
    const posts = [];

    // 1. Try the robust data-view-name selector (User suggestion)
    let postContainers = document.querySelectorAll('[data-view-name="feed-full-update"]');

    // 2. Try showcase pages (.fie-impression-container)
    if (!postContainers || postContainers.length === 0) {
      postContainers = document.querySelectorAll('.fie-impression-container');
    }

    // 3. Fallback: Try to find posts in personal activity pages (list items)
    if (!postContainers || postContainers.length === 0) {
      postContainers = document.querySelectorAll('li.LPVJOEBjAblxTFDZPnYBFyOfsMrkGNYwpsVNbU');
    }

    // 4. Fallback: If no posts found, try organization/company posts structure (div containers)
    if (!postContainers || postContainers.length === 0) {
      // Look for organization posts in div.scaffold-finite-scroll__content > div > div structure
      const scaffoldContent = document.querySelector('.scaffold-finite-scroll__content');
      if (scaffoldContent) {
        // Find all divs that contain feed-shared-update-v2
        const allDivs = scaffoldContent.querySelectorAll('div');
        const validPostDivs = Array.from(allDivs).filter(div => {
          return div.querySelector('.feed-shared-update-v2') !== null;
        });
        postContainers = validPostDivs;
      }
    }

    if (!postContainers || postContainers.length === 0) {
      log('No posts found on activity/company page', 'warn');
      return posts;
    }

    postContainers.forEach((container, index) => {
      try {
        // Find the feed update element
        const feedUpdate = container.querySelector('.feed-shared-update-v2');
        if (!feedUpdate) {
          // Skip if this is not a valid post (might be a placeholder)
          return;
        }

        const postData = extractPostData(feedUpdate, container);
        if (postData) {
          posts.push(postData);
        }
      } catch (error) {
        log(`Error extracting post ${index}: ${error.message} `, 'warn');
      }
    });

    log(`Extracted ${posts.length} posts from activity / company page`);

    // Log the extracted JSON data to console
    if (posts.length > 0) {
      log('=== Extracted Posts JSON Data ===\n' + JSON.stringify(posts, null, 2) + '\n=== End of Extracted Posts JSON ===');
    }

    return posts;
  } catch (error) {
    log(`Error extracting posts from activity page: ${error.message} `, 'error');
    return [];
  }
}

/**
 * Extracts data from a single post element
 * @param {Element} feedUpdate - The feed update element
 * @param {Element} container - The container element
 * @returns {Object} Post data object
 */
function extractPostData(feedUpdate, container) {
  const postData = {
    type: 'post',
    author: {},
    content: {},
    engagement: {},
    media: [],
    timestamp: null,
    isRepost: false
  };

  try {
    // Extract author information
    const authorInfo = extractAuthorInfo(feedUpdate);
    if (authorInfo) {
      postData.author = authorInfo;
    }

    // Check if this is a repost
    const headerText = feedUpdate.querySelector('.update-components-header__text-view');
    if (headerText && headerText.textContent.includes('repost')) {
      postData.isRepost = true;
      // For reposts, find the original author
      const originalAuthor = feedUpdate.querySelector('.update-components-actor__title');
      if (originalAuthor) {
        const authorName = originalAuthor.textContent.trim();
        const authorLink = feedUpdate.querySelector('.update-components-actor__meta-link');
        if (authorLink) {
          postData.originalAuthor = {
            name: authorName,
            url: authorLink.href || null
          };
        }
      }
    }

    // Extract post content
    const contentInfo = extractPostContent(feedUpdate);
    if (contentInfo) {
      postData.content = contentInfo;
    }

    // Extract engagement metrics
    const engagementInfo = extractEngagementMetrics(feedUpdate);
    if (engagementInfo) {
      postData.engagement = engagementInfo;
    }

    // Extract media (images, articles, etc.)
    const mediaInfo = extractMedia(feedUpdate);
    if (mediaInfo && mediaInfo.length > 0) {
      postData.media = mediaInfo;
    }

    // Extract timestamp
    const timestamp = extractTimestamp(feedUpdate);
    if (timestamp) {
      postData.timestamp = timestamp;
    }

    // Extract post URN if available
    const urn = feedUpdate.getAttribute('data-urn');
    if (urn) {
      postData.urn = urn;
    }

    return postData;
  } catch (error) {
    log(`Error extracting post data: ${error.message} `, 'error');
    return null;
  }
}

/**
 * Extracts author information from a post
 * @param {Element} feedUpdate - The feed update element
 * @returns {Object} Author information object
 */
function extractAuthorInfo(feedUpdate) {
  const authorInfo = {};

  try {
    // Try to find author name
    const authorNameElement = feedUpdate.querySelector('.update-components-actor__title span');
    if (authorNameElement) {
      authorInfo.name = authorNameElement.textContent.trim();
    }

    // Try to find author link
    const authorLinkElement = feedUpdate.querySelector('.update-components-actor__meta-link');
    if (authorLinkElement) {
      authorInfo.url = authorLinkElement.href || null;
    }

    // Try to find author title/description
    const authorDescriptionElement = feedUpdate.querySelector('.update-components-actor__description span');
    if (authorDescriptionElement) {
      authorInfo.description = authorDescriptionElement.textContent.trim();
    }

    // Try to find author avatar
    const authorAvatarElement = feedUpdate.querySelector('.update-components-actor__avatar-image');
    if (authorAvatarElement) {
      authorInfo.avatarUrl = authorAvatarElement.src || null;
    }
  } catch (error) {
    // console.warn('Error extracting author info:', error);
  }

  return authorInfo;
}

/**
 * Extracts post content (title and body text)
 * @param {Element} feedUpdate - The feed update element
 * @returns {Object} Content information object
 */
function extractPostContent(feedUpdate) {
  const contentInfo = {};

  try {
    // Extract post text/body
    const textElement = feedUpdate.querySelector('.update-components-text');
    if (textElement) {
      // Get all text nodes, handling nested elements
      contentInfo.body = textElement.innerText.trim();

      // Also try to get HTML for rich content
      const textHTML = textElement.innerHTML;
      if (textHTML) {
        contentInfo.bodyHtml = textHTML;
      }
    }

    // Extract article title if present (for shared articles)
    const articleTitleElement = feedUpdate.querySelector('.update-components-article__title');
    if (articleTitleElement) {
      contentInfo.articleTitle = articleTitleElement.textContent.trim();

      // Extract article URL
      const articleLinkElement = feedUpdate.querySelector('.update-components-article__meta');
      if (articleLinkElement) {
        contentInfo.articleUrl = articleLinkElement.href || null;
      }

      // Extract article source
      const articleSourceElement = feedUpdate.querySelector('.update-components-article__subtitle');
      if (articleSourceElement) {
        contentInfo.articleSource = articleSourceElement.textContent.trim();
      }
    }

    // Extract job posting title if present
    const jobTitleElement = feedUpdate.querySelector('.update-components-entity__title');
    if (jobTitleElement) {
      contentInfo.jobTitle = jobTitleElement.textContent.trim();

      // Extract job company
      const jobCompanyElement = feedUpdate.querySelector('.update-components-entity__subtitle');
      if (jobCompanyElement) {
        contentInfo.jobCompany = jobCompanyElement.textContent.trim();
      }

      // Extract job location
      const jobLocationElement = feedUpdate.querySelector('.update-components-entity__description');
      if (jobLocationElement) {
        contentInfo.jobLocation = jobLocationElement.textContent.trim();
      }

      // Extract job URL
      const jobLinkElement = feedUpdate.querySelector('.update-components-entity__content');
      if (jobLinkElement) {
        contentInfo.jobUrl = jobLinkElement.href || null;
      }
    }
  } catch (error) {
    // console.warn('Error extracting post content:', error);
  }

  return contentInfo;
}

/**
 * Extracts engagement metrics (likes, comments, reposts)
 * @param {Element} feedUpdate - The feed update element
 * @returns {Object} Engagement metrics object
 */
function extractEngagementMetrics(feedUpdate) {
  const engagement = {
    likes: 0,
    comments: 0,
    reposts: 0
  };

  try {
    // Extract likes/reactions count
    const reactionsCountElement = feedUpdate.querySelector('.social-details-social-counts__reactions-count');
    if (reactionsCountElement) {
      const reactionsText = reactionsCountElement.textContent.trim();
      const reactionsMatch = reactionsText.match(/(\d+)/);
      if (reactionsMatch) {
        engagement.likes = parseInt(reactionsMatch[1], 10) || 0;
      }
    }

    // Extract comments count - try multiple selectors
    const commentsButton = feedUpdate.querySelector('.social-details-social-counts__comments button');
    if (commentsButton) {
      const commentsText = commentsButton.textContent.trim();
      const commentsMatch = commentsText.match(/(\d+)/);
      if (commentsMatch) {
        engagement.comments = parseInt(commentsMatch[1], 10) || 0;
      }
    }

    // Extract reposts count - look for button with aria-label containing "Repost"
    const allButtons = feedUpdate.querySelectorAll('.social-details-social-counts__item button');
    allButtons.forEach((button) => {
      const ariaLabel = button.getAttribute('aria-label') || '';
      const buttonText = button.textContent.trim();

      // Check if this is a repost button
      if (ariaLabel.toLowerCase().includes('repost') ||
        buttonText.toLowerCase().includes('repost')) {
        const repostsMatch = (ariaLabel + ' ' + buttonText).match(/(\d+)/);
        if (repostsMatch) {
          engagement.reposts = parseInt(repostsMatch[1], 10) || 0;
        }
      }
    });

    // Fallback: try to find reposts by class name
    if (engagement.reposts === 0) {
      const repostsButton = feedUpdate.querySelector('.social-details-social-counts__item--truncate-text button');
      if (repostsButton) {
        const repostsText = repostsButton.textContent.trim();
        const repostsMatch = repostsText.match(/(\d+)/);
        if (repostsMatch) {
          engagement.reposts = parseInt(repostsMatch[1], 10) || 0;
        }
      }
    }
  } catch (error) {
    // console.warn('Error extracting engagement metrics:', error);
  }

  return engagement;
}

/**
 * Extracts media URLs from a post (images, videos, etc.)
 * @param {Element} feedUpdate - The feed update element
 * @returns {Array} Array of media objects with URLs
 */
function extractMedia(feedUpdate) {
  const media = [];

  try {
    // Extract images from post content
    const imageElements = feedUpdate.querySelectorAll('.update-components-image__image, .update-components-article__image');
    imageElements.forEach((img) => {
      if (img.src) {
        media.push({
          type: 'image',
          url: img.src,
          alt: img.alt || null
        });
      }
    });

    // Extract article images
    const articleImageElement = feedUpdate.querySelector('.update-components-article__image');
    if (articleImageElement && articleImageElement.src) {
      media.push({
        type: 'article-image',
        url: articleImageElement.src,
        alt: articleImageElement.alt || null
      });
    }

    // Extract company/entity logo if present
    const entityImageElement = feedUpdate.querySelector('.update-components-entity__image-container img');
    if (entityImageElement && entityImageElement.src) {
      media.push({
        type: 'entity-logo',
        url: entityImageElement.src,
        alt: entityImageElement.alt || null
      });
    }
  } catch (error) {
    // console.warn('Error extracting media:', error);
  }

  return media;
}

/**
 * Extracts timestamp from a post
 * @param {Element} feedUpdate - The feed update element
 * @returns {string|null} Timestamp string or null
 */
function extractTimestamp(feedUpdate) {
  try {
    const timestampElement = feedUpdate.querySelector('.update-components-actor__sub-description span');
    if (timestampElement) {
      return timestampElement.textContent.trim();
    }
  } catch (error) {
    // console.warn('Error extracting timestamp:', error);
  }
  return null;
}

/**
 * Scrolls the page to trigger lazy loading
 */
/**
 * Waits for a specific number of posts to be loaded using MutationObserver and scrolling
 * @param {number} targetCount - Number of posts to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function waitForPosts(targetCount = 3, timeout = 20000) {
  return new Promise((resolve) => {
    log(`Waiting for ${targetCount} posts...`);

    const getPostCount = () => {
      // Check for standard feed posts
      let posts = document.querySelectorAll('[data-view-name="feed-full-update"]');

      // If no standard posts, check for showcase pages
      if (!posts || posts.length === 0) {
        posts = document.querySelectorAll('.fie-impression-container');
      }

      return posts.length;
    };

    // Check if we already have enough posts
    if (getPostCount() >= targetCount) {
      log(`Already have ${getPostCount()} posts.`);
      return resolve();
    }

    let totalHeight = 0;
    const distance = 300; // Scroll faster
    let scrollTimer = null;

    // Function to scroll down
    const scrollDown = () => {
      const scrollHeight = document.body.scrollHeight;
      window.scrollBy(0, distance);
      totalHeight += distance;

      // If we hit bottom, wait a bit and try again (lazy loading)
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight) {
        // Reached bottom
      }
    };

    // Start scrolling
    scrollTimer = setInterval(scrollDown, 200);

    const observer = new MutationObserver(() => {
      const count = getPostCount();
      if (count >= targetCount) {
        log(`Found ${count} posts. Stopping wait.`);
        clearInterval(scrollTimer);
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Timeout fallback
    setTimeout(() => {
      log(`Timeout waiting for posts. Found ${getPostCount()}.`);
      clearInterval(scrollTimer);
      observer.disconnect();
      resolve();
    }, timeout);
  });
}

/**
 * Main message listener for handling requests from popup
 * Processes activity page data extraction
 */
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  log(`Activity content script received message: ${request.action} on URL: ${window.location.href} `);

  // Handle activity data extraction requests
  if (request.action === "getActivityData") {
    (async () => {
      try {
        // Wait for posts to load
        const topK = request.data?.topK || 3;
        log(`Waiting for ${topK} posts...`);
        await waitForPosts(topK);

        const posts = extractAllPosts();
        log(`Extracted ${posts.length} posts from activity / company page`);

        // Get the profile/company URL from the current page
        let profileUrl = window.location.href;
        if (window.location.href.includes('/recent-activity')) {
          profileUrl = window.location.href.split('/recent-activity')[0];
        } else if (window.location.href.includes('/posts')) {
          profileUrl = window.location.href.split('/posts')[0];
        }

        const activityData = {
          posts: posts,
          profileUrl: profileUrl,
          totalPosts: posts.length,
          pageType: 'activity'
        };

        // Log the extracted data JSON to console
        log('=== Activity Data JSON ===\n' + JSON.stringify(activityData, null, 2) + '\n=== End of Activity Data JSON ===');

        sendResponse({
          success: true,
          data: activityData
        });
      } catch (error) {
        log(`Error extracting activity data: ${error.message} `, 'error');
        sendResponse({
          success: false,
          message: 'Failed to extract activity data: ' + error.message
        });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Handle profile data preview requests (for compatibility)
  if (request.action === "getProfileData") {
    (async () => {
      try {
        const posts = extractAllPosts();

        // Get the profile/company URL from the current page
        let profileUrl = window.location.href;
        if (window.location.href.includes('/recent-activity')) {
          profileUrl = window.location.href.split('/recent-activity')[0];
        } else if (window.location.href.includes('/posts')) {
          profileUrl = window.location.href.split('/posts')[0];
        }

        const activityData = {
          posts: posts,
          profileUrl: profileUrl,
          totalPosts: posts.length,
          pageType: 'activity'
        };

        // Log the extracted data JSON to console
        log('=== Profile Data (Activity) JSON ===\n' + JSON.stringify(activityData, null, 2) + '\n=== End of Profile Data JSON ===');

        sendResponse({
          success: true,
          data: activityData
        });
      } catch (error) {
        log(`Error extracting profile data from activity page: ${error.message} `, 'error');
        sendResponse({
          success: false,
          message: 'Failed to extract data: ' + error.message
        });
      }
    })();
    return true;
  }

  // Handle API send requests for activity pages
  if (request.action === "sendToApi") {
    (async () => {
      try {
        const posts = extractAllPosts();

        // Get the profile/company URL from the current page
        let profileUrl = window.location.href;
        if (window.location.href.includes('/recent-activity')) {
          profileUrl = window.location.href.split('/recent-activity')[0];
        } else if (window.location.href.includes('/posts')) {
          profileUrl = window.location.href.split('/posts')[0];
        }

        const activityData = {
          list: request.formData?.list || null,
          rating: request.formData?.stars || null,
          notes: request.formData?.notes || null,
          posts: posts,
          profileUrl: profileUrl,
          totalPosts: posts.length,
          pageType: 'activity',
          linkedinUrl: window.location.href
        };

        // Log the activity data JSON to console
        log('=== Activity Data JSON ===\n' + JSON.stringify(activityData, null, 2) + '\n=== End of Activity Data JSON ===');

        // If it's a sendToApi request, forward to background script
        log("Forwarding activity data to background script for API processing");

        chrome.runtime.sendMessage({
          action: "sendToApi",
          activityData: activityData
        }, (response) => {
          if (chrome.runtime.lastError) {
            log(`Error communicating with background script: ${chrome.runtime.lastError.message} `, 'error');
            sendResponse({
              success: false,
              message: 'Failed to communicate with background script: ' + chrome.runtime.lastError.message
            });
          } else {
            log(`Background script response: ${JSON.stringify(response)} `);
            sendResponse(response);
          }
        });
      } catch (error) {
        log(`Error processing activity data: ${error.message} `, 'error');
        sendResponse({
          success: false,
          message: 'Failed to process activity data: ' + error.message
        });
      }
    })();
    return true; // Keep message channel open for async response
  }

  // Handle ping requests to check if content script is ready
  if (request.action === "ping") {
    sendResponse({ success: true, data: { message: "pong" } });
    return true;
  }
});
