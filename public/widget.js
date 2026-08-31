// Widget version 3.4 - Mobile opens as 70% bottom sheet with rounded corners
(function() {
  'use strict';
  
  console.log('[Hi Chroney Widget] Version 3.4 - Mobile opens as 70% bottom sheet! 📱');
  
  // CRITICAL FIX: Detect if any ancestor has CSS transforms that cause touch target misalignment
  // On mobile, transformed ancestors cause touch coordinates to not match visual positions
  function hasTransformedAncestor(element) {
    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      const transform = style.transform || style.webkitTransform;
      const perspective = style.perspective || style.webkitPerspective;
      
      // Check for non-identity transforms
      if (transform && transform !== 'none') {
        console.log('[Hi Chroney] Found transformed ancestor:', parent, 'transform:', transform);
        return true;
      }
      if (perspective && perspective !== 'none') {
        console.log('[Hi Chroney] Found perspective ancestor:', parent, 'perspective:', perspective);
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }
  
  // Ensure widget container is directly in body to avoid transform inheritance
  function ensureDirectBodyChild(container) {
    if (window.innerWidth > 480) return; // Only needed on mobile
    
    if (hasTransformedAncestor(container)) {
      console.log('[Hi Chroney] Reparenting widget to document.body to fix touch coordinates');
      // Store original parent for cleanup
      container._originalParent = container.parentElement;
      container._originalNextSibling = container.nextSibling;
      // Move to body
      document.body.appendChild(container);
    }
  }
  
  // Force widget visibility with comprehensive inline styles to override host website CSS
  // This is critical because host websites may have global CSS that hides or modifies widget elements
  function forceWidgetVisibility(container, button) {
    // Use data attribute for synchronous state check to prevent race conditions
    const isButtonHidden = button.dataset.forceHidden === 'true';
    
    // Use setProperty to add/override individual properties without clearing existing ones
    // Container visibility properties - ALWAYS apply these (even when button is hidden)
    container.style.setProperty('display', 'block', 'important');
    container.style.setProperty('visibility', 'visible', 'important');
    container.style.setProperty('opacity', '1', 'important');
    container.style.setProperty('pointer-events', 'auto', 'important');
    container.style.setProperty('position', 'fixed', 'important');
    container.style.setProperty('z-index', '2147483647', 'important');
    container.style.setProperty('transform', 'none', 'important');
    container.style.setProperty('clip', 'auto', 'important');
    container.style.setProperty('clip-path', 'none', 'important');
    container.style.setProperty('overflow', 'visible', 'important');
    container.style.setProperty('width', 'auto', 'important');
    container.style.setProperty('height', 'auto', 'important');
    container.style.setProperty('max-width', 'none', 'important');
    container.style.setProperty('max-height', 'none', 'important');
    container.style.setProperty('min-width', '0', 'important');
    container.style.setProperty('min-height', '0', 'important');
    
    // Button visibility properties - ONLY apply if button should be visible
    if (!isButtonHidden) {
      button.style.setProperty('display', 'flex', 'important');
      button.style.setProperty('visibility', 'visible', 'important');
      button.style.setProperty('opacity', '1', 'important');
      button.style.setProperty('pointer-events', 'auto', 'important');
      button.style.setProperty('transform', 'none', 'important');
      button.style.setProperty('clip', 'auto', 'important');
      button.style.setProperty('clip-path', 'none', 'important');
      button.style.setProperty('overflow', 'visible', 'important');
    }
    
    // Use multiple animation frames to ensure styles persist after any host CSS recalculation
    requestAnimationFrame(() => {
      container.style.setProperty('display', 'block', 'important');
      container.style.setProperty('visibility', 'visible', 'important');
      
      // Only enforce button visibility if not intentionally hidden (check data attribute)
      if (button.dataset.forceHidden !== 'true') {
        button.style.setProperty('display', 'flex', 'important');
        button.style.setProperty('visibility', 'visible', 'important');
      }
      
      requestAnimationFrame(() => {
        // Final enforcement after any potential host script interference
        const containerStyle = getComputedStyle(container);
        
        if (containerStyle.display === 'none' || containerStyle.visibility === 'hidden') {
          console.log('[Hi Chroney] Container was hidden by host, re-enforcing visibility');
          container.style.setProperty('display', 'block', 'important');
          container.style.setProperty('visibility', 'visible', 'important');
        }
        
        // Only check button visibility if not intentionally hidden (check data attribute)
        if (button.dataset.forceHidden !== 'true') {
          const buttonStyle = getComputedStyle(button);
          if (buttonStyle.display === 'none' || buttonStyle.visibility === 'hidden') {
            console.log('[Hi Chroney] Button was hidden by host, re-enforcing visibility');
            button.style.setProperty('display', 'flex', 'important');
            button.style.setProperty('visibility', 'visible', 'important');
          }
        }
      });
    });
  }
  
  // Hide button and remove ALL inline visibility styles
  // This allows the CSS .pill--hidden class to take full effect
  function hideButtonCompletely(button) {
    // Set data attribute FIRST for synchronous state tracking
    button.dataset.forceHidden = 'true';
    button.classList.add('pill--hidden');
    button.classList.remove('pill--visible', 'pill-expanded');
    // Remove ALL inline styles that would override the CSS class
    button.style.removeProperty('display');
    button.style.removeProperty('visibility');
    button.style.removeProperty('opacity');
    button.style.removeProperty('pointer-events');
    button.style.removeProperty('transform');
    button.style.removeProperty('clip');
    button.style.removeProperty('clip-path');
    button.style.removeProperty('overflow');
    console.log('[Hi Chroney] Button hidden completely');
  }
  
  // Show button and reset state
  function showButtonCompletely(button) {
    button.dataset.forceHidden = 'false';
    button.classList.remove('pill--hidden');
    button.classList.add('pill--visible');
    console.log('[Hi Chroney] Button shown');
  }
  
  // Sound style functions for AI activation
  // Style 1: Chime - Rising shimmer (default)
  function playSoundChime(audioContext, masterGain) {
    const now = audioContext.currentTime;
    
    // First tone - rising shimmer (C5)
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.4, now + 0.05);
    gain1.gain.linearRampToValueAtTime(0, now + 0.3);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.35);
    
    // Second tone - harmonic (E5)
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.25);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.45);
    
    // Third tone - resolution (G5)  
    const osc3 = audioContext.createOscillator();
    const gain3 = audioContext.createGain();
    osc3.type = 'triangle';
    osc3.frequency.setValueAtTime(783.99, now + 0.15);
    gain3.gain.setValueAtTime(0, now + 0.15);
    gain3.gain.linearRampToValueAtTime(0.25, now + 0.2);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc3.connect(gain3);
    gain3.connect(masterGain);
    osc3.start(now + 0.15);
    osc3.stop(now + 0.65);
    
    // Soft high sparkle
    const osc4 = audioContext.createOscillator();
    const gain4 = audioContext.createGain();
    osc4.type = 'sine';
    osc4.frequency.setValueAtTime(1318.51, now + 0.2);
    gain4.gain.setValueAtTime(0, now + 0.2);
    gain4.gain.linearRampToValueAtTime(0.1, now + 0.25);
    gain4.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc4.connect(gain4);
    gain4.connect(masterGain);
    osc4.start(now + 0.2);
    osc4.stop(now + 0.55);
  }
  
  // Style 2: Bell - Soft, elegant bell tone
  function playSoundBell(audioContext, masterGain) {
    const now = audioContext.currentTime;
    
    // Main bell tone
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now); // A5
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.5, now + 0.01);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.85);
    
    // Harmonic overtone
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1760, now); // A6
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now);
    osc2.stop(now + 0.55);
    
    // Second bell echo
    const osc3 = audioContext.createOscillator();
    const gain3 = audioContext.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(1318.51, now + 0.15); // E6
    gain3.gain.setValueAtTime(0, now + 0.15);
    gain3.gain.linearRampToValueAtTime(0.25, now + 0.16);
    gain3.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
    osc3.connect(gain3);
    gain3.connect(masterGain);
    osc3.start(now + 0.15);
    osc3.stop(now + 0.75);
  }
  
  // Style 3: Pop - Quick, modern notification
  function playSoundPop(audioContext, masterGain) {
    const now = audioContext.currentTime;
    
    // Quick pop with frequency slide
    const osc1 = audioContext.createOscillator();
    const gain1 = audioContext.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(400, now);
    osc1.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.5, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.2);
    
    // Second pop - higher
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(600, now + 0.08);
    osc2.frequency.exponentialRampToValueAtTime(1200, now + 0.16);
    gain2.gain.setValueAtTime(0, now + 0.08);
    gain2.gain.linearRampToValueAtTime(0.4, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.3);
  }
  
  // Play AI activation sound based on selected style
  function playOpeningSound(style) {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const now = audioContext.currentTime;
      
      // Create master gain for overall volume control
      const masterGain = audioContext.createGain();
      masterGain.gain.setValueAtTime(0.15, now);
      masterGain.connect(audioContext.destination);
      
      // Play selected sound style
      switch (style) {
        case 'bell':
          playSoundBell(audioContext, masterGain);
          break;
        case 'pop':
          playSoundPop(audioContext, masterGain);
          break;
        case 'chime':
        default:
          playSoundChime(audioContext, masterGain);
          break;
      }
      
      console.log('[Hi Chroney] AI opening sound played:', style);
      
      // Clean up audio context after sounds finish
      setTimeout(() => {
        audioContext.close().catch(() => {});
      }, 1000);
      
    } catch (e) {
      console.log('[Hi Chroney] Could not play opening sound:', e.message);
    }
  }
  
  // Get or create persistent visitor token for unique visitor tracking
  function getVisitorToken() {
    var bid = window.chroneyConfig && window.chroneyConfig.businessAccountId;
    var perBusinessKey = bid ? 'chroney_visitor_' + bid : null;
    var globalKey = 'chroney_visitor_token';
    var legacyKey = 'chroney_page_visitor_token';
    var token = (perBusinessKey && localStorage.getItem(perBusinessKey)) || localStorage.getItem(globalKey) || localStorage.getItem(legacyKey);
    if (!token) {
      token = crypto.randomUUID ? crypto.randomUUID() : 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    if (perBusinessKey) localStorage.setItem(perBusinessKey, token);
    localStorage.setItem(globalKey, token);
    localStorage.setItem(legacyKey, token);
    return token;
  }
  
  // Get device info for tracking
  function getDeviceInfo() {
    const ua = navigator.userAgent;
    let deviceType = 'desktop';
    if (/Mobile|Android|iPhone|iPod/.test(ua)) {
      deviceType = 'mobile';
    } else if (/iPad|Tablet/.test(ua)) {
      deviceType = 'tablet';
    }
    
    let browser = 'Unknown';
    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('Chrome')) browser = 'Chrome';
    else if (ua.includes('Safari')) browser = 'Safari';
    else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';
    
    let os = 'Unknown';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    
    return { deviceType, browser, os, userAgent: ua };
  }
  
  // ============================================================================
  // PRODUCT PAGE DETECTOR - Detects ecommerce product pages and extracts data
  // Supports: Shopify, WooCommerce, Magento, BigCommerce, custom stores
  // ============================================================================
  
  const ProductPageDetector = {
    productData: null,
    
    detect() {
      const url = window.location.href;
      const path = window.location.pathname;
      
      // Try platform-specific detection first
      let data = this.detectShopify() 
                || this.detectWooCommerce() 
                || this.detectMagento() 
                || this.detectBigCommerce()
                || this.detectJsonLd()
                || this.detectOpenGraph();
      
      if (data) {
        this.productData = data;
        console.log('[Hi Chroney] Product page detected:', data.platform, data.name);
        return data;
      }
      
      // Check URL pattern as fallback
      if (path.includes('/product') || path.includes('/products/') || path.includes('/item/')) {
        // Try to extract from page content
        data = this.extractFromPage();
        if (data) {
          this.productData = data;
          console.log('[Hi Chroney] Product page detected from page content:', data.name);
          return data;
        }
      }
      
      return null;
    },
    
    detectShopify() {
      try {
        // Method 1: ShopifyAnalytics.meta.product
        if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
          const p = window.ShopifyAnalytics.meta.product;
          return {
            platform: 'shopify',
            id: p.id,
            name: p.title || document.querySelector('h1')?.innerText,
            description: p.description || '',
            price: p.price ? (p.price / 100).toFixed(2) : this.findPrice(),
            image: this.findProductImage(),
            currency: window.Shopify?.currency?.active || 'USD',
            url: window.location.href
          };
        }
        
        // Method 2: window.meta.product (Shopify 2.0 themes)
        if (window.meta && window.meta.product) {
          const p = window.meta.product;
          return {
            platform: 'shopify',
            id: p.id,
            name: p.title,
            description: p.description || '',
            price: p.price ? (p.price / 100).toFixed(2) : this.findPrice(),
            image: this.findProductImage(),
            currency: window.Shopify?.currency?.active || 'USD',
            url: window.location.href
          };
        }
        
        // Method 3: Product JSON in page (liquid template)
        const productJson = document.querySelector('[data-product-json], script[type="application/json"][data-product-json]');
        if (productJson) {
          const p = JSON.parse(productJson.textContent);
          return {
            platform: 'shopify',
            id: p.id,
            name: p.title,
            description: p.description || '',
            price: p.price ? (p.price / 100).toFixed(2) : this.findPrice(),
            image: p.featured_image || this.findProductImage(),
            currency: window.Shopify?.currency?.active || 'USD',
            url: window.location.href
          };
        }
      } catch (e) {
        console.log('[Hi Chroney] Shopify detection failed:', e.message);
      }
      return null;
    },
    
    detectWooCommerce() {
      try {
        // Check for WooCommerce product page
        if (document.body.classList.contains('single-product') || window.wc_product_params) {
          const name = document.querySelector('.product_title, h1.product-title')?.innerText;
          const priceEl = document.querySelector('.price .woocommerce-Price-amount, .product-price');
          
          if (name) {
            return {
              platform: 'woocommerce',
              id: document.body.className.match(/postid-(\d+)/)?.[1] || null,
              name: name,
              description: document.querySelector('.woocommerce-product-details__short-description, .product-short-description')?.innerText || '',
              price: priceEl?.innerText || this.findPrice(),
              image: this.findProductImage(),
              currency: window.wc_product_params?.currency || 'USD',
              url: window.location.href
            };
          }
        }
      } catch (e) {
        console.log('[Hi Chroney] WooCommerce detection failed:', e.message);
      }
      return null;
    },
    
    detectMagento() {
      try {
        // Check for Magento product config
        if (window.productConfig || window.catalog_product) {
          const config = window.productConfig || window.catalog_product;
          return {
            platform: 'magento',
            id: config.productId || config.id,
            name: config.productName || document.querySelector('h1.page-title span')?.innerText,
            description: document.querySelector('.product.attribute.description .value')?.innerText || '',
            price: config.price || this.findPrice(),
            image: this.findProductImage(),
            currency: config.currencyCode || 'USD',
            url: window.location.href
          };
        }
      } catch (e) {
        console.log('[Hi Chroney] Magento detection failed:', e.message);
      }
      return null;
    },
    
    detectBigCommerce() {
      try {
        // Check for BigCommerce
        if (window.BCData && window.BCData.product_attributes) {
          const p = window.BCData.product_attributes;
          return {
            platform: 'bigcommerce',
            id: p.product_id,
            name: p.product_title || document.querySelector('h1.productView-title')?.innerText,
            description: document.querySelector('.productView-description')?.innerText || '',
            price: p.price?.without_tax?.formatted || this.findPrice(),
            image: this.findProductImage(),
            currency: 'USD',
            url: window.location.href
          };
        }
      } catch (e) {
        console.log('[Hi Chroney] BigCommerce detection failed:', e.message);
      }
      return null;
    },
    
    detectJsonLd() {
      try {
        // Check JSON-LD structured data (universal across all platforms)
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          const data = JSON.parse(script.textContent);
          const product = Array.isArray(data) 
            ? data.find(item => item['@type'] === 'Product')
            : (data['@type'] === 'Product' ? data : null);
          
          if (product) {
            return {
              platform: 'json-ld',
              id: product.sku || product.productID || null,
              name: product.name,
              description: product.description || '',
              price: product.offers?.price || product.offers?.[0]?.price || this.findPrice(),
              image: product.image || (Array.isArray(product.image) ? product.image[0] : null) || this.findProductImage(),
              currency: product.offers?.priceCurrency || product.offers?.[0]?.priceCurrency || 'USD',
              url: window.location.href,
              reviews: product.aggregateRating ? {
                rating: product.aggregateRating.ratingValue,
                count: product.aggregateRating.reviewCount
              } : null
            };
          }
        }
      } catch (e) {
        console.log('[Hi Chroney] JSON-LD detection failed:', e.message);
      }
      return null;
    },
    
    detectOpenGraph() {
      try {
        // Check Open Graph meta tags
        const ogType = document.querySelector('meta[property="og:type"]')?.content;
        if (ogType === 'product' || ogType === 'og:product') {
          return {
            platform: 'opengraph',
            id: null,
            name: document.querySelector('meta[property="og:title"]')?.content || document.querySelector('h1')?.innerText,
            description: document.querySelector('meta[property="og:description"]')?.content || '',
            price: document.querySelector('meta[property="product:price:amount"]')?.content || this.findPrice(),
            image: document.querySelector('meta[property="og:image"]')?.content || this.findProductImage(),
            currency: document.querySelector('meta[property="product:price:currency"]')?.content || 'USD',
            url: window.location.href
          };
        }
      } catch (e) {
        console.log('[Hi Chroney] OpenGraph detection failed:', e.message);
      }
      return null;
    },
    
    extractFromPage() {
      try {
        const name = document.querySelector('h1')?.innerText;
        if (!name) return null;
        
        return {
          platform: 'generic',
          id: null,
          name: name,
          description: document.querySelector('meta[name="description"]')?.content || '',
          price: this.findPrice(),
          image: this.findProductImage(),
          currency: 'USD',
          url: window.location.href
        };
      } catch (e) {
        return null;
      }
    },
    
    findPrice() {
      // Try common price selectors
      const priceSelectors = [
        '.price', '.product-price', '.current-price', '[data-price]',
        '.Price', '.product__price', '.pdp-price', '.sale-price'
      ];
      
      for (const selector of priceSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.innerText || el.textContent;
          const match = text.match(/[\d,.]+/);
          if (match) return match[0];
        }
      }
      return null;
    },
    
    findProductImage() {
      // Try common image selectors
      const imgSelectors = [
        '.product-image img', '.product__media img', '[data-product-image]',
        '.pdp-image img', '.gallery-image img', '.product-featured-image'
      ];
      
      for (const selector of imgSelectors) {
        const el = document.querySelector(selector);
        if (el && el.src) return el.src;
      }
      
      // Fallback to first large image
      const images = document.querySelectorAll('img');
      for (const img of images) {
        if (img.width > 200 && img.height > 200) {
          return img.src;
        }
      }
      return null;
    },
    
    getProductData() {
      if (!this.productData) {
        this.detect();
      }
      return this.productData;
    },
    
    isProductPage() {
      return this.getProductData() !== null;
    }
  };
  
  const HiChroneyWidget = {
    visitorToken: null,
    _iframeReady: false,
    _sendMessageToIframe: null,
    _openWidget: null,
    _pendingOpen: false,

    // Public host-page API. Calls made before the async widget has finished
    // initializing are replayed as soon as the launcher is ready.
    open: function() {
      if (typeof this._openWidget === 'function') {
        this._openWidget();
        return true;
      }

      this._pendingOpen = true;
      console.log('[Hi Chroney] Open request queued until the widget is ready');
      return false;
    },
    
    init: async function(config) {
      if (!config || !config.businessAccountId) {
        console.error('[Hi Chroney] businessAccountId is required');
        return;
      }

      // Track page visit immediately (before chat opens)
      const baseUrl = this.getBaseUrl();
      this.visitorToken = getVisitorToken();
      
      // Fire page visit tracking (fire-and-forget for performance)
      try {
        const deviceInfo = getDeviceInfo();
        fetch(`${baseUrl}/api/widget/page-visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessAccountId: config.businessAccountId,
            visitorToken: this.visitorToken,
            pageUrl: window.location.href,
            ...deviceInfo
          })
        }).then(() => {
          console.log('[Hi Chroney] Page visit tracked');
        }).catch(err => {
          console.log('[Hi Chroney] Page visit tracking failed (non-critical):', err.message);
        });
      } catch (e) {
        // Silent fail - tracking is non-critical
      }

      // Fetch widget settings from API to get latest colors
      try {
        const response = await fetch(`${baseUrl}/api/widget-settings/public?businessAccountId=${encodeURIComponent(config.businessAccountId)}`);
        if (response.ok) {
          const settings = await response.json();
          console.log('[Hi Chroney] Loaded settings:', settings);
          // Parse conversationStarters if it's a JSON string
          let parsedStarters = [];
          if (settings.conversationStarters) {
            if (typeof settings.conversationStarters === 'string') {
              try {
                parsedStarters = JSON.parse(settings.conversationStarters);
              } catch (e) {
                console.warn('[Hi Chroney] Failed to parse conversationStarters:', e);
                parsedStarters = [];
              }
            } else if (Array.isArray(settings.conversationStarters)) {
              parsedStarters = settings.conversationStarters;
            }
          }
          
          this.config = {
            businessAccountId: config.businessAccountId,
            topscholarToken: config.topscholarToken || null,
            studentBoard: config.studentBoard || null,
            studentMedium: config.studentMedium || null,
            studentGrade: config.studentGrade || null,
            studentSubject: config.studentSubject || null,
            studentChapter: config.studentChapter || null,
            studentId: config.studentId || null,
            studentName: config.studentName || null,
            mode: config.mode || null,
            container: config.container || null,
            k12EducationEnabled: settings.k12EducationEnabled === true || settings.k12EducationEnabled === 'true',
            chatColor: settings.chatColor || '#9333ea',
            chatColorEnd: settings.chatColorEnd || '#3b82f6',
            buttonStyle: settings.buttonStyle || 'circular',
            buttonAnimation: settings.buttonAnimation || 'bounce',
            welcomeMessageType: settings.welcomeMessageType || 'ai_generated',
            widgetHeaderText: settings.widgetHeaderText || 'Hi Chroney',
            widgetWidth: settings.widgetWidth || '400',
            widgetHeight: settings.widgetHeight || '600',
            widgetPosition: settings.widgetPosition || 'bottom-right',
            bubbleSize: settings.bubbleSize || '60',
            pillBottomOffset: settings.pillBottomOffset || '20',
            pillSideOffset: settings.pillSideOffset || '20',
            autoOpenChat: config.proactiveGuidanceActive ? 'both' : (settings.autoOpenChat || 'false'),
            autoOpenFrequency: config.proactiveGuidanceActive ? 'always' : (settings.autoOpenFrequency || 'once'),
            proactiveGuidanceActive: config.proactiveGuidanceActive || false,
            avatarType: settings.avatarType || 'none',
            avatarUrl: settings.avatarUrl || null,
            chatMode: settings.chatMode || 'chat-only',
            voiceModeEnabled: settings.voiceModeEnabled || false,
            voiceModeStyle: settings.voiceModeStyle || 'circular',
            conversationStarters: parsedStarters,
            showConversationStarters: settings.showConversationStarters !== false,
            showStartersOnPill: settings.showStartersOnPill === 'true',
            proactiveNudgeEnabled: settings.proactiveNudgeEnabled || 'true',
            proactiveNudgeDelay: settings.proactiveNudgeDelay || '15',
            proactiveNudgeMessage: settings.proactiveNudgeMessage || "Need help finding something? I'm here to assist!",
            proactiveNudgeMessages: settings.proactiveNudgeMessages || [],
            proactiveNudgeRepeat: settings.proactiveNudgeRepeat || 'false',
            proactiveNudgeBgColor: settings.proactiveNudgeBgColor || '#ffffff',
            proactiveNudgeBgColorEnd: settings.proactiveNudgeBgColorEnd || '#ffffff',
            proactiveNudgeTextColor: settings.proactiveNudgeTextColor || '#1f2937',
            centerBannerEnabled: settings.centerBannerEnabled || 'false',
            centerBannerDelay: settings.centerBannerDelay || '10',
            centerBannerTitle: settings.centerBannerTitle || 'Need Help?',
            centerBannerDescription: settings.centerBannerDescription || "Let me help you find exactly what you're looking for.",
            centerBannerButtonText: settings.centerBannerButtonText || 'Start Chat',
            centerBannerShowOnce: settings.centerBannerShowOnce || 'true',
            centerBannerBackgroundStyle: settings.centerBannerBackgroundStyle || 'gradient',
            centerBannerStartColor: settings.centerBannerStartColor || '#9333ea',
            centerBannerEndColor: settings.centerBannerEndColor || '#3b82f6',
            centerBannerTextColor: settings.centerBannerTextColor || 'white',
            centerBannerImageUrl: settings.centerBannerImageUrl || null,
            reengagementBannerEnabled: settings.reengagementBannerEnabled || 'false',
            reengagementBannerDelay: settings.reengagementBannerDelay || '60',
            reengagementBannerTitle: settings.reengagementBannerTitle || 'Still looking around?',
            reengagementBannerDescription: settings.reengagementBannerDescription || "I'm here whenever you're ready to chat!",
            reengagementBannerButtonText: settings.reengagementBannerButtonText || 'Chat Now',
            openingSoundEnabled: settings.openingSoundEnabled || 'true',
            openingSoundStyle: settings.openingSoundStyle || 'chime',
            productPageModeEnabled: settings.productPageModeEnabled || 'false',
            showAiTrivia: settings.showAiTrivia || 'true',
            showSuggestedQuestions: settings.showSuggestedQuestions || 'true',
            showReviewSummary: settings.showReviewSummary || 'true',
            launcherMode: settings.launcherMode || 'ai',
            whatsappWidgetNumber: settings.whatsappWidgetNumber || null,
            whatsappWidgetLabel: settings.whatsappWidgetLabel || 'How can I help you?',
            whatsappWidgetMessage: settings.whatsappWidgetMessage || null,
            whatsappWidgetColor: settings.whatsappWidgetColor || '#25D366',
            whatsappWidgetPosition: settings.whatsappWidgetPosition || null
          };
          console.log('[Hi Chroney] Button will use colors:', this.config.chatColor, this.config.chatColorEnd);
          console.log('[Hi Chroney] Widget size:', this.config.widgetWidth, 'x', this.config.widgetHeight);
          console.log('[Hi Chroney] Avatar settings:', this.config.avatarType, this.config.avatarUrl);
          console.log('[Hi Chroney] Chat mode:', this.config.chatMode, 'Voice enabled:', this.config.voiceModeEnabled);
          console.log('[Hi Chroney] Conversation starters:', this.config.conversationStarters);
          console.log('[Hi Chroney] Center banner:', {
            enabled: this.config.centerBannerEnabled,
            delay: this.config.centerBannerDelay,
            title: this.config.centerBannerTitle,
            showOnce: this.config.centerBannerShowOnce,
            bgStyle: this.config.centerBannerBackgroundStyle
          });
          
          // Prewarm cache in background for faster first response
          this.prewarmCache(baseUrl, config.businessAccountId);
        } else {
          // Fallback to config values if API fails
          this.config = {
            businessAccountId: config.businessAccountId,
            topscholarToken: config.topscholarToken || null,
            studentBoard: config.studentBoard || null,
            studentMedium: config.studentMedium || null,
            studentGrade: config.studentGrade || null,
            studentSubject: config.studentSubject || null,
            studentChapter: config.studentChapter || null,
            studentId: config.studentId || null,
            studentName: config.studentName || null,
            mode: config.mode || null,
            container: config.container || null,
            k12EducationEnabled: false,
            chatColor: config.chatColor || '#9333ea',
            chatColorEnd: config.chatColorEnd || '#3b82f6',
            buttonStyle: config.buttonStyle || 'circular',
            buttonAnimation: config.buttonAnimation || 'bounce',
            welcomeMessageType: config.welcomeMessageType || 'ai_generated',
            widgetWidth: config.widgetWidth || '400',
            widgetHeight: config.widgetHeight || '600',
            widgetPosition: config.widgetPosition || 'bottom-right',
            bubbleSize: config.bubbleSize || '60',
            pillBottomOffset: config.pillBottomOffset || '20',
            pillSideOffset: config.pillSideOffset || '20',
            autoOpenChat: config.autoOpenChat || 'false',
            avatarType: 'none',
            avatarUrl: null,
            voiceModeStyle: 'circular'
          };
        }
      } catch (error) {
        console.warn('[Hi Chroney] Failed to fetch settings, using defaults:', error);
        this.config = {
          businessAccountId: config.businessAccountId,
          topscholarToken: config.topscholarToken || null,
          studentBoard: config.studentBoard || null,
          studentMedium: config.studentMedium || null,
          studentGrade: config.studentGrade || null,
          studentSubject: config.studentSubject || null,
          studentChapter: config.studentChapter || null,
          studentId: config.studentId || null,
          studentName: config.studentName || null,
          mode: config.mode || null,
          container: config.container || null,
          k12EducationEnabled: false,
          chatColor: config.chatColor || '#9333ea',
          chatColorEnd: config.chatColorEnd || '#3b82f6',
          buttonStyle: config.buttonStyle || 'circular',
          buttonAnimation: config.buttonAnimation || 'bounce',
          welcomeMessageType: config.welcomeMessageType || 'ai_generated',
          widgetWidth: config.widgetWidth || '400',
          widgetHeight: config.widgetHeight || '600',
          widgetPosition: config.widgetPosition || 'bottom-right',
          bubbleSize: config.bubbleSize || '60',
          pillBottomOffset: config.pillBottomOffset || '20',
          pillSideOffset: config.pillSideOffset || '20',
          autoOpenChat: config.autoOpenChat || 'false',
          avatarType: 'none',
          avatarUrl: null,
          voiceModeStyle: 'circular'
        };
      }

      // Determine which launcher(s) to render based on launcherMode.
      // 'ai' (default) -> AI chat only; 'whatsapp' -> WhatsApp click-to-chat only;
      // 'both' -> WhatsApp launcher stacked above the AI chat bubble.
      // Fail-safe: if WhatsApp is selected but the number is missing/invalid,
      // fall back to the AI launcher so the widget is never left with nothing.
      let launcherMode = this.config.launcherMode || 'ai';
      if (launcherMode !== 'ai' && launcherMode !== 'whatsapp' && launcherMode !== 'both') {
        launcherMode = 'ai'; // defensive: coerce any unexpected value back to the safe default
      }
      const waDigits = String(this.config.whatsappWidgetNumber || '').replace(/[^\d]/g, '');
      const waValid = waDigits.length >= 8;
      const wantsWhatsapp = (launcherMode === 'whatsapp' || launcherMode === 'both') && waValid;
      const showAiLauncher = launcherMode === 'ai' || launcherMode === 'both' || (launcherMode === 'whatsapp' && !waValid);

      // Render the AI launcher (voice orb or chat bubble) only when AI is enabled
      // for the current launcherMode. In WhatsApp-only mode, neither is shown.
      if (showAiLauncher) {
        if (this.config.chatMode === 'voice-only' && this.config.voiceModeEnabled) {
          this.createVoiceOnlyWidget();
        } else {
          this.createWidget();
        }
      }

      // Render the WhatsApp click-to-chat launcher when requested.
      if (wantsWhatsapp) {
        // Resolve the WhatsApp launcher's corner. Empty/invalid = inherit the chat widget's position.
        const aiPosition = this.config.widgetPosition || 'bottom-right';
        const validPositions = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
        const waPosition = validPositions.indexOf(this.config.whatsappWidgetPosition) !== -1
          ? this.config.whatsappWidgetPosition
          : aiPosition;
        // Stack (round icon above the AI bubble) only when WhatsApp shares the AI launcher's
        // corner in "both" mode. In a different corner, render standalone in its own corner.
        const stacked = showAiLauncher && (waPosition === aiPosition);
        this.createWhatsappLauncher(stacked, waDigits, waPosition);
      }
      
      // Initialize Product Page AI Mode if enabled
      if (this.config.productPageModeEnabled === 'true') {
        this.initProductPageMode(baseUrl);
      }
      
      // Initialize visitor session for tracking
      VisitorSession.init();
      
      // Initialize exit intent and idle timeout tracking
      ExitIntentTracker.init({
        businessId: this.config.businessAccountId,
        apiBaseUrl: baseUrl
      });
      
      IdleTimeoutTracker.init({
        businessId: this.config.businessAccountId,
        apiBaseUrl: baseUrl
      });
    },

    getBaseUrl: function() {
      // Prefer the base URL set explicitly by widget-loader.js. This avoids
      // relying on script-tag scanning, which breaks on Shopify and other
      // platforms that proxy or rewrite external script URLs (causing the
      // iframe to fall back to window.location.origin and 404).
      if (window.__chroneyBaseUrl) {
        return window.__chroneyBaseUrl;
      }
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (src && src.includes('/widget.js')) {
          try {
            const url = new URL(src);
            return `${url.protocol}//${url.host}`;
          } catch (e) {
            console.error('[Hi Chroney] Failed to parse script URL:', e);
          }
        }
      }
      return window.location.origin;
    },

    prewarmCache: function(baseUrl, businessAccountId) {
      // Fire-and-forget server-side cache warming for AI context
      // This preloads business context, products, FAQs etc. into server memory
      // so the first AI response is faster
      fetch(`${baseUrl}/api/chat/prewarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessAccountId })
      }).then(() => {
        console.log('[Hi Chroney] Server-side AI context cache warmed');
      }).catch(error => {
        // Silently fail - this is a performance optimization, not critical
        console.log('[Hi Chroney] Cache prewarm failed (non-critical):', error.message);
      });
    },
    
    // Product Page AI Mode - shows AI assistant card when on a product page
    initProductPageMode: async function(baseUrl) {
      console.log('[Hi Chroney] Checking for product page...');
      
      // Detect if we're on a product page
      const productData = ProductPageDetector.detect();
      if (!productData) {
        console.log('[Hi Chroney] Not a product page, skipping AI mode');
        return;
      }
      
      console.log('[Hi Chroney] Product page detected, initializing AI assistant', productData);
      
      // Store product data for chat context
      this.currentProductData = productData;
      
      // Create the AI assistant card
      this.createProductAICard(baseUrl, productData);
    },
    
    createProductAICard: async function(baseUrl, productData) {
      const config = this.config;
      const position = config.widgetPosition || 'bottom-right';
      const [verticalPos, horizontalPos] = position.split('-');
      const bottomOff = parseInt(config.pillBottomOffset, 10) || 20;
      const sideOff = parseInt(config.pillSideOffset, 10) || 20;
      
      // Add styles for the product AI card
      const cardStyles = document.createElement('style');
      cardStyles.id = 'hichroney-product-ai-styles';
      cardStyles.textContent = `
        #hichroney-product-ai-card {
          position: fixed;
          ${horizontalPos === 'left' ? 'left: ' + sideOff + 'px' : 'right: ' + sideOff + 'px'};
          ${verticalPos === 'top' ? 'top: ' + bottomOff + 'px' : 'bottom: ' + (bottomOff + 70) + 'px'};
          width: 320px;
          max-width: calc(100vw - 40px);
          background: white;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08);
          z-index: 999997;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          transform: translateY(20px);
          opacity: 0;
        }
        
        #hichroney-product-ai-card.visible {
          transform: translateY(0);
          opacity: 1;
        }
        
        #hichroney-product-ai-card.minimized {
          width: auto;
          min-width: 200px;
        }
        
        #hichroney-product-ai-card.hidden {
          display: none;
        }
        
        .hichroney-ai-card-header {
          background: linear-gradient(135deg, ${config.chatColor || '#9333ea'}, ${config.chatColorEnd || '#3b82f6'});
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: white;
        }
        
        .hichroney-ai-card-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .hichroney-ai-card-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(255,255,255,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .hichroney-ai-card-title {
          font-size: 14px;
          font-weight: 600;
        }
        
        .hichroney-ai-card-actions {
          display: flex;
          gap: 8px;
        }
        
        .hichroney-ai-card-btn {
          background: none;
          border: none;
          color: white;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: background 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .hichroney-ai-card-btn:hover {
          background: rgba(255,255,255,0.2);
        }
        
        .hichroney-ai-card-content {
          padding: 16px;
        }
        
        .hichroney-ai-card-content.loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100px;
        }
        
        .hichroney-ai-trivia {
          background: linear-gradient(135deg, ${config.chatColor || '#9333ea'}15, ${config.chatColorEnd || '#3b82f6'}15);
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 12px;
          font-size: 13px;
          line-height: 1.5;
          color: #333;
        }
        
        .hichroney-ai-trivia-icon {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: ${config.chatColor || '#9333ea'};
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        
        .hichroney-ai-questions {
          margin-bottom: 12px;
        }
        
        .hichroney-ai-questions-label {
          font-size: 11px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
          font-weight: 600;
        }
        
        .hichroney-ai-question-btn {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          margin-bottom: 6px;
          background: #f5f5f5;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          color: #333;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .hichroney-ai-question-btn:hover {
          background: linear-gradient(135deg, ${config.chatColor || '#9333ea'}20, ${config.chatColorEnd || '#3b82f6'}20);
          color: ${config.chatColor || '#9333ea'};
        }
        
        .hichroney-ai-question-btn:last-child {
          margin-bottom: 0;
        }
        
        .hichroney-ai-review-summary {
          background: #f8f9fa;
          border-radius: 12px;
          padding: 12px;
          margin-bottom: 12px;
        }
        
        .hichroney-ai-review-header {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #f59e0b;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 8px;
        }
        
        .hichroney-ai-rating {
          background: #f59e0b;
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          margin-left: auto;
        }
        
        .hichroney-ai-review-text {
          font-size: 13px;
          line-height: 1.5;
          color: #333;
        }
        
        .hichroney-ai-ask-input {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #eee;
        }
        
        .hichroney-ai-ask-input input {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid #e0e0e0;
          border-radius: 20px;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s;
        }
        
        .hichroney-ai-ask-input input:focus {
          border-color: ${config.chatColor || '#9333ea'};
        }
        
        .hichroney-ai-ask-input button {
          background: linear-gradient(135deg, ${config.chatColor || '#9333ea'}, ${config.chatColorEnd || '#3b82f6'});
          color: white;
          border: none;
          border-radius: 50%;
          width: 36px;
          height: 36px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .hichroney-ai-ask-input button:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        
        .hichroney-loading-dots {
          display: flex;
          gap: 4px;
        }
        
        .hichroney-loading-dots span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: ${config.chatColor || '#9333ea'};
          animation: hichroney-dot-bounce 1.4s infinite ease-in-out both;
        }
        
        .hichroney-loading-dots span:nth-child(1) { animation-delay: -0.32s; }
        .hichroney-loading-dots span:nth-child(2) { animation-delay: -0.16s; }
        
        @keyframes hichroney-dot-bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
        
        @media (max-width: 480px) {
          #hichroney-product-ai-card {
            width: calc(100vw - 20px);
            ${horizontalPos === 'left' ? 'left: 10px' : 'right: 10px'};
            bottom: 80px;
          }
        }
      `;
      document.head.appendChild(cardStyles);
      
      // Create the card element
      const card = document.createElement('div');
      card.id = 'hichroney-product-ai-card';
      
      // Create header
      const header = document.createElement('div');
      header.className = 'hichroney-ai-card-header';
      header.innerHTML = `
        <div class="hichroney-ai-card-header-left">
          <div class="hichroney-ai-card-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"></path>
              <circle cx="9" cy="13" r="1"></circle>
              <circle cx="15" cy="13" r="1"></circle>
              <path d="M9 17h6"></path>
            </svg>
          </div>
          <span class="hichroney-ai-card-title">AI Assistant</span>
        </div>
        <div class="hichroney-ai-card-actions">
          <button class="hichroney-ai-card-btn" id="hichroney-ai-minimize" title="Minimize">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14"></path>
            </svg>
          </button>
          <button class="hichroney-ai-card-btn" id="hichroney-ai-close" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"></path>
            </svg>
          </button>
        </div>
      `;
      card.appendChild(header);
      
      // Create content area with loading state
      const content = document.createElement('div');
      content.className = 'hichroney-ai-card-content loading';
      content.innerHTML = `
        <div class="hichroney-loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      `;
      card.appendChild(content);
      
      document.body.appendChild(card);
      
      // Animate in
      setTimeout(() => card.classList.add('visible'), 100);
      
      // Add event listeners
      document.getElementById('hichroney-ai-minimize').addEventListener('click', () => {
        card.classList.toggle('minimized');
      });
      
      document.getElementById('hichroney-ai-close').addEventListener('click', () => {
        card.classList.add('hidden');
        // Store preference for this session
        sessionStorage.setItem('hichroney_ai_card_closed', 'true');
      });
      
      // Check if user already closed the card this session
      if (sessionStorage.getItem('hichroney_ai_card_closed') === 'true') {
        card.classList.add('hidden');
        return;
      }
      
      // Fetch AI content in parallel
      const showTrivia = config.showAiTrivia === 'true';
      const showQuestions = config.showSuggestedQuestions === 'true';
      const showReviewSummary = config.showReviewSummary === 'true';
      
      const promises = [];
      
      if (showTrivia) {
        promises.push(
          fetch(`${baseUrl}/api/widget/product-trivia`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId: config.businessAccountId,
              product: productData
            })
          }).then(r => r.ok ? r.json() : { trivia: null }).catch(() => ({ trivia: null }))
        );
      } else {
        promises.push(Promise.resolve({ trivia: null }));
      }
      
      if (showQuestions) {
        promises.push(
          fetch(`${baseUrl}/api/widget/product-questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId: config.businessAccountId,
              product: productData
            })
          }).then(r => r.ok ? r.json() : { questions: [] }).catch(() => ({ questions: [] }))
        );
      } else {
        promises.push(Promise.resolve({ questions: [] }));
      }
      
      if (showReviewSummary) {
        promises.push(
          fetch(`${baseUrl}/api/widget/product-review-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId: config.businessAccountId,
              product: productData,
              reviews: productData.reviews || []
            })
          }).then(r => r.ok ? r.json() : { summary: null }).catch(() => ({ summary: null }))
        );
      } else {
        promises.push(Promise.resolve({ summary: null }));
      }
      
      const [triviaResult, questionsResult, reviewResult] = await Promise.all(promises);
      
      // Build content HTML
      let contentHtml = '';
      
      if (triviaResult.trivia) {
        contentHtml += `
          <div class="hichroney-ai-trivia">
            <div class="hichroney-ai-trivia-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
              </svg>
              Did you know?
            </div>
            <div>${triviaResult.trivia}</div>
          </div>
        `;
      }
      
      if (questionsResult.questions && questionsResult.questions.length > 0) {
        contentHtml += `
          <div class="hichroney-ai-questions">
            <div class="hichroney-ai-questions-label">Quick Questions</div>
            ${questionsResult.questions.map(q => `<button class="hichroney-ai-question-btn">${q}</button>`).join('')}
          </div>
        `;
      }
      
      if (reviewResult.summary) {
        contentHtml += `
          <div class="hichroney-ai-review-summary">
            <div class="hichroney-ai-review-header">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
              </svg>
              <span>Review Summary</span>
              ${reviewResult.averageRating ? `<span class="hichroney-ai-rating">${reviewResult.averageRating}/5</span>` : ''}
            </div>
            <div class="hichroney-ai-review-text">${reviewResult.summary}</div>
          </div>
        `;
      }
      
      contentHtml += `
        <div class="hichroney-ai-ask-input">
          <input type="text" placeholder="Ask about ${productData.name?.substring(0, 30) || 'this product'}..." id="hichroney-ai-input" />
          <button id="hichroney-ai-send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
            </svg>
          </button>
        </div>
      `;
      
      content.className = 'hichroney-ai-card-content';
      content.innerHTML = contentHtml;
      
      // Add click handlers for questions
      content.querySelectorAll('.hichroney-ai-question-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const question = btn.textContent;
          this.openChatWithProductContext(question, productData);
        });
      });
      
      // Add send button handler
      const inputEl = document.getElementById('hichroney-ai-input');
      const sendBtn = document.getElementById('hichroney-ai-send');
      
      const sendMessage = () => {
        const message = inputEl.value.trim();
        if (message) {
          this.openChatWithProductContext(message, productData);
          inputEl.value = '';
        }
      };
      
      sendBtn.addEventListener('click', sendMessage);
      inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
      });
    },
    
    openChatWithProductContext: function(message, productData) {
      // Find and click the widget button to open chat
      const widgetButton = document.getElementById('hichroney-widget-button');
      const iframe = document.getElementById('hichroney-widget-iframe');
      
      if (widgetButton && iframe) {
        // Open the chat if not already open
        if (!widgetButton.classList.contains('open')) {
          widgetButton.click();
        }
        
        // Use the stored sendMessageToIframe function if available (handles queue)
        // Otherwise, wait for EMBED_READY and send with retry logic
        const messageData = {
          type: 'SEND_MESSAGE_WITH_CONTEXT',
          message: message,
          productContext: {
            name: productData.name,
            price: productData.price,
            description: productData.description,
            url: productData.url
          }
        };
        
        // Check if widget's sendMessageToIframe is exposed
        if (this._sendMessageToIframe) {
          this._sendMessageToIframe(messageData);
        } else {
          // Fallback: Wait for EMBED_READY signal with retry logic
          let attempts = 0;
          const maxAttempts = 20;
          const checkAndSend = () => {
            attempts++;
            if (this._iframeReady) {
              iframe.contentWindow.postMessage(messageData, '*');
            } else if (attempts < maxAttempts) {
              setTimeout(checkAndSend, 100);
            } else {
              // Final attempt after max retries
              iframe.contentWindow.postMessage(messageData, '*');
            }
          };
          checkAndSend();
        }
      }
      
      // Hide the AI card after sending
      const card = document.getElementById('hichroney-product-ai-card');
      if (card) {
        card.classList.add('hidden');
      }
    },

    createVoiceOnlyWidget: function() {
      console.log('[Hi Chroney] Creating voice-only widget');
      const baseUrl = this.getBaseUrl();
      const position = this.config.widgetPosition || 'bottom-right';
      const [verticalPos, horizontalPos] = position.split('-');
      
      // Get voice mode style
      const voiceStyle = this.config.voiceModeStyle || 'circular';
      
      // Define animations based on voice mode style (combined to avoid transform conflicts)
      let orbAnimation = 'hichroney-style-circular 3s ease-in-out infinite';
      let orbBorderRadius = '50%';
      let clipPath = 'none';
      let orbOverflow = 'hidden';
      
      if (voiceStyle === 'morphing') {
        orbAnimation = 'hichroney-style-morphing 3s ease-in-out infinite';
      } else if (voiceStyle === 'distorted') {
        orbAnimation = 'hichroney-style-distorted 4s ease-in-out infinite';
      } else if (voiceStyle === 'angular') {
        orbBorderRadius = '20%';
        orbAnimation = 'hichroney-style-angular 8s linear infinite';
      } else if (voiceStyle === 'ocean-wave' || voiceStyle === 'ocean_wave') {
        orbAnimation = 'hichroney-style-ocean 3s ease-in-out infinite';
      } else if (voiceStyle === 'triangle') {
        clipPath = 'polygon(50% 0%, 0% 100%, 100% 100%)';
        orbBorderRadius = '0';
        orbAnimation = 'hichroney-style-triangle 4s ease-in-out infinite';
      } else if (voiceStyle === 'hexagon') {
        clipPath = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
        orbBorderRadius = '0';
        orbAnimation = 'hichroney-style-hexagon 6s linear infinite';
      } else if (voiceStyle === 'diamond') {
        clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
        orbBorderRadius = '0';
        orbAnimation = 'hichroney-style-diamond 3s ease-in-out infinite';
      } else if (voiceStyle === 'infinity') {
        // Figure-8 using pseudo-elements for two overlapping circles
        orbBorderRadius = '50%';
        orbOverflow = 'visible'; // Allow pseudo-elements to extend beyond orb
        orbAnimation = 'hichroney-style-infinity 8s ease-in-out infinite';
      }
      
      // Add styles for voice-only orb with responsive sizing
      const voiceStyles = document.createElement('style');
      voiceStyles.textContent = `
        #hichroney-voice-orb-container {
          position: fixed;
          ${verticalPos === 'top' ? 'top: ' + (parseInt(this.config.pillBottomOffset, 10) || 20) + 'px;' : 'bottom: ' + (parseInt(this.config.pillBottomOffset, 10) || 20) + 'px;'}
          ${horizontalPos === 'right' ? 'right: ' + (parseInt(this.config.pillSideOffset, 10) || 20) + 'px;' : 'left: ' + (parseInt(this.config.pillSideOffset, 10) || 20) + 'px;'}
          width: clamp(56px, 8vw, 88px);
          height: clamp(56px, 8vw, 88px);
          z-index: 999999;
        }
        
        #hichroney-voice-orb {
          width: 100%;
          height: 100%;
          border-radius: ${orbBorderRadius};
          clip-path: ${clipPath};
          background: linear-gradient(135deg, ${this.config.chatColor}, ${this.config.chatColorEnd});
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: ${orbOverflow};
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
          animation: ${orbAnimation};
        }
        
        #hichroney-voice-orb:hover {
          transform: scale(1.05);
        }
        
        #hichroney-voice-orb:active {
          transform: scale(0.95);
        }
        
        /* Infinity figure-8 pseudo-elements - only apply for infinity style */
        #hichroney-voice-orb::before,
        #hichroney-voice-orb::after {
          ${voiceStyle === 'infinity' ? `
          content: '';
          position: absolute;
          width: 70%;
          height: 70%;
          border-radius: 50%;
          background: linear-gradient(135deg, ${this.config.chatColor}, ${this.config.chatColorEnd});
          top: 50%;
          ` : ''}
        }
        
        #hichroney-voice-orb::before {
          ${voiceStyle === 'infinity' ? `
          left: -30%;
          transform: translateY(-50%);
          ` : ''}
        }
        
        #hichroney-voice-orb::after {
          ${voiceStyle === 'infinity' ? `
          right: -30%;
          transform: translateY(-50%);
          ` : ''}
        }
        
        /* Responsive sizing overrides */
        @media (max-width: 480px) {
          #hichroney-voice-orb-container {
            width: 56px;
            height: 56px;
          }
        }
        
        @media (min-width: 481px) and (max-width: 1024px) {
          #hichroney-voice-orb-container {
            width: 72px;
            height: 72px;
          }
        }
        
        @media (min-width: 1025px) {
          #hichroney-voice-orb-container {
            width: 88px;
            height: 88px;
          }
        }
        
        .hichroney-pulse-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 2px solid ${this.config.chatColor}66;
          animation: hichroney-pulse-expand 2.5s ease-out infinite;
        }
        
        .hichroney-pulse-ring:nth-child(2) {
          animation-delay: 1.25s;
        }
        
        .hichroney-cloud-blob {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.2);
          filter: blur(10px);
        }
        
        .hichroney-inner-glow {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          background: radial-gradient(circle, ${this.config.chatColor}80, transparent);
          filter: blur(20px);
          animation: hichroney-glow-pulse 2.5s ease-in-out infinite;
        }
        
        .hichroney-avatar-wrapper {
          position: relative;
          z-index: 20;
          width: 64%;
          height: 64%;
          border-radius: 50%;
          overflow: hidden;
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 0 20px rgba(0, 0, 0, 0.2);
        }
        
        .hichroney-avatar-wrapper img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        /* Responsive avatar sizing */
        @media (max-width: 480px) {
          .hichroney-avatar-wrapper {
            width: 36px;
            height: 36px;
          }
        }
        
        @media (min-width: 481px) and (max-width: 1024px) {
          .hichroney-avatar-wrapper {
            width: 46px;
            height: 46px;
          }
        }
        
        @media (min-width: 1025px) {
          .hichroney-avatar-wrapper {
            width: 56px;
            height: 56px;
          }
        }
        
        /* Combined animations - pulse + style-specific effects */
        @keyframes hichroney-style-circular {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        
        @keyframes hichroney-style-morphing {
          0%, 100% { 
            transform: scale(1);
            border-radius: 50%; 
          }
          25% { 
            transform: scale(1.01);
            border-radius: 48%; 
          }
          50% { 
            transform: scale(1.02);
            border-radius: 50%; 
          }
          75% { 
            transform: scale(1.01);
            border-radius: 52%; 
          }
        }
        
        @keyframes hichroney-style-distorted {
          0%, 100% { 
            border-radius: 50% 45% 48% 52%; 
            transform: scale(1) rotate(0deg); 
          }
          25% { 
            border-radius: 48% 52% 50% 46%; 
            transform: scale(1.01) rotate(2deg); 
          }
          50% { 
            border-radius: 52% 48% 46% 50%; 
            transform: scale(1.02) rotate(-2deg); 
          }
          75% { 
            border-radius: 46% 50% 52% 48%; 
            transform: scale(1.01) rotate(1deg); 
          }
        }
        
        @keyframes hichroney-style-angular {
          from { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.02) rotate(180deg); }
          to { transform: scale(1) rotate(360deg); }
        }
        
        @keyframes hichroney-style-ocean {
          0%, 100% { 
            border-radius: 50% 48% 52% 50%;
            transform: scale(1) translateY(0);
          }
          33% { 
            border-radius: 48% 52% 50% 48%;
            transform: scale(1.01) translateY(-2px);
          }
          66% { 
            border-radius: 52% 50% 48% 52%;
            transform: scale(0.99) translateY(2px);
          }
        }
        
        @keyframes hichroney-style-triangle {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
          }
          25% { 
            transform: scale(1.01) rotate(2deg);
          }
          50% { 
            transform: scale(1.02) rotate(0deg);
          }
          75% { 
            transform: scale(1.01) rotate(-2deg);
          }
        }
        
        @keyframes hichroney-style-hexagon {
          from { 
            transform: scale(1) rotate(0deg);
          }
          50% { 
            transform: scale(1.02) rotate(180deg);
          }
          to { 
            transform: scale(1) rotate(360deg);
          }
        }
        
        @keyframes hichroney-style-diamond {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
          }
          25% { 
            transform: scale(1.05) rotate(5deg);
          }
          50% { 
            transform: scale(1) rotate(0deg);
          }
          75% { 
            transform: scale(1.05) rotate(-5deg);
          }
        }
        
        @keyframes hichroney-style-infinity {
          0%, 100% { 
            transform: scale(1) rotate(0deg);
            border-radius: 50% 40% 50% 40%;
          }
          12.5% { 
            transform: scale(0.95) rotate(45deg);
            border-radius: 45% 50% 45% 50%;
          }
          25% { 
            transform: scale(1.05) rotate(90deg);
            border-radius: 40% 50% 40% 50%;
          }
          37.5% { 
            transform: scale(0.95) rotate(135deg);
            border-radius: 50% 45% 50% 45%;
          }
          50% { 
            transform: scale(1) rotate(180deg);
            border-radius: 50% 40% 50% 40%;
          }
          62.5% { 
            transform: scale(1.05) rotate(225deg);
            border-radius: 45% 50% 45% 50%;
          }
          75% { 
            transform: scale(0.95) rotate(270deg);
            border-radius: 40% 50% 40% 50%;
          }
          87.5% { 
            transform: scale(1.05) rotate(315deg);
            border-radius: 50% 45% 50% 45%;
          }
        }
        
        @keyframes hichroney-pulse-expand {
          0% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.5); opacity: 0; }
          100% { transform: scale(1); opacity: 0.6; }
        }
        
        @keyframes hichroney-glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.6; }
        }
        
        @keyframes hichroney-blob-float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(10px, -10px) scale(1.1); }
        }
        
        @keyframes hichroney-blob-float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-15px, 5px) scale(0.9); }
        }
        
        @keyframes hichroney-blob-float-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(5px, 15px) scale(1.05); }
        }
      `;
      document.head.appendChild(voiceStyles);
      
      // Create orb container
      const container = document.createElement('div');
      container.id = 'hichroney-voice-orb-container';
      
      // Add pulse rings
      const pulseRing1 = document.createElement('div');
      pulseRing1.className = 'hichroney-pulse-ring';
      const pulseRing2 = document.createElement('div');
      pulseRing2.className = 'hichroney-pulse-ring';
      container.appendChild(pulseRing1);
      container.appendChild(pulseRing2);
      
      // Create orb button
      const orb = document.createElement('button');
      orb.id = 'hichroney-voice-orb';
      orb.setAttribute('aria-label', 'Start voice chat');
      
      // Add cloud blobs
      const blob1 = document.createElement('div');
      blob1.className = 'hichroney-cloud-blob';
      blob1.style.cssText = 'width: 72px; height: 72px; top: 10%; left: 15%; animation: hichroney-blob-float-1 5s ease-in-out infinite;';
      
      const blob2 = document.createElement('div');
      blob2.className = 'hichroney-cloud-blob';
      blob2.style.cssText = 'width: 60px; height: 60px; bottom: 15%; right: 10%; animation: hichroney-blob-float-2 6s ease-in-out infinite;';
      
      const blob3 = document.createElement('div');
      blob3.className = 'hichroney-cloud-blob';
      blob3.style.cssText = 'width: 66px; height: 66px; top: 40%; left: 5%; animation: hichroney-blob-float-3 6.5s ease-in-out infinite 1.5s;';
      
      orb.appendChild(blob1);
      orb.appendChild(blob2);
      orb.appendChild(blob3);
      
      // Add inner glow
      const glow = document.createElement('div');
      glow.className = 'hichroney-inner-glow';
      orb.appendChild(glow);
      
      // Add avatar or mic icon
      if (this.config.avatarType && this.config.avatarType !== 'none') {
        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'hichroney-avatar-wrapper';
        const avatarImg = document.createElement('img');
        avatarImg.src = this.config.avatarType === 'custom' ? 
          this.config.avatarUrl : 
          `${baseUrl}/avatars/avatar-${this.config.avatarType.replace('preset-', '')}.png`;
        avatarImg.alt = 'AI Assistant';
        avatarWrapper.appendChild(avatarImg);
        orb.appendChild(avatarWrapper);
      } else {
        const micIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        micIcon.setAttribute('width', '40');
        micIcon.setAttribute('height', '40');
        micIcon.setAttribute('viewBox', '0 0 24 24');
        micIcon.setAttribute('fill', 'none');
        micIcon.setAttribute('stroke', 'white');
        micIcon.setAttribute('stroke-width', '2');
        micIcon.style.cssText = 'position: relative; z-index: 20; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));';
        
        const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path1.setAttribute('d', 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z');
        const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path2.setAttribute('d', 'M19 10v2a7 7 0 0 1-14 0v-2');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '12');
        line.setAttribute('y1', '19');
        line.setAttribute('x2', '12');
        line.setAttribute('y2', '23');
        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', '8');
        line2.setAttribute('y1', '23');
        line2.setAttribute('x2', '16');
        line2.setAttribute('y2', '23');
        
        micIcon.appendChild(path1);
        micIcon.appendChild(path2);
        micIcon.appendChild(line);
        micIcon.appendChild(line2);
        orb.appendChild(micIcon);
      }
      
      // Handle click - open voice mode iframe
      orb.addEventListener('click', () => {
        console.log('[Hi Chroney] Opening voice mode');
        // Create fullscreen iframe for voice mode
        const iframe = document.createElement('iframe');
        iframe.id = 'hichroney-voice-iframe';
        iframe.setAttribute('allow', 'microphone; autoplay');
        
        const iframeUrl = new URL(`${baseUrl}/embed/chat`);
        iframeUrl.searchParams.set('businessAccountId', this.config.businessAccountId);
        iframeUrl.searchParams.set('chatColor', this.config.chatColor);
        iframeUrl.searchParams.set('chatColorEnd', this.config.chatColorEnd);
        iframeUrl.searchParams.set('autoOpenVoice', 'true');
        
        iframe.src = iframeUrl.toString();
        iframe.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          border: none;
          z-index: 9999999;
          background: transparent;
        `;
        
        // Listen for close message
        const closeHandler = (event) => {
          if (event.data === 'CLOSE_WIDGET' && event.source === iframe.contentWindow) {
            document.body.removeChild(iframe);
            window.removeEventListener('message', closeHandler);
          }
        };
        window.addEventListener('message', closeHandler);
        
        document.body.appendChild(iframe);
      });
      
      container.appendChild(orb);
      document.body.appendChild(container);
    },

    // Renders a WhatsApp click-to-chat launcher. When the AI launcher is also
    // shown (launcherMode 'both'), this is rendered as a round icon stacked
    // above the AI bubble. When WhatsApp is the only launcher, it is rendered
    // as a full pill with the configured label.
    createWhatsappLauncher: function(aiAlsoShown, waDigits, waPosition) {
      const position = waPosition || this.config.widgetPosition || 'bottom-right';
      const [verticalPos, horizontalPos] = position.split('-');
      const bubbleSize = parseInt(this.config.bubbleSize, 10) || 60;
      const bottomOffset = parseInt(this.config.pillBottomOffset, 10) || 20;
      const sideOffset = parseInt(this.config.pillSideOffset, 10) || 20;
      const waColor = this.config.whatsappWidgetColor || '#25D366';
      const label = this.config.whatsappWidgetLabel || 'How can I help you?';
      const message = this.config.whatsappWidgetMessage || '';
      const waUrl = 'https://wa.me/' + waDigits + (message ? ('?text=' + encodeURIComponent(message)) : '');

      // When stacked with the AI bubble, sit above it (accounting for the AI
      // launcher's actual height: pill style is 64px tall, others use bubbleSize).
      const aiHeight = (this.config.buttonStyle === 'pill') ? 64 : bubbleSize;
      const gap = 14;
      const vOffset = aiAlsoShown ? (bottomOffset + aiHeight + gap) : bottomOffset;

      const verticalCss = verticalPos === 'top' ? 'top: ' + vOffset + 'px;' : 'bottom: ' + vOffset + 'px;';
      const horizontalCss = horizontalPos === 'right' ? 'right: ' + sideOffset + 'px;' : 'left: ' + sideOffset + 'px;';

      const iconSize = aiAlsoShown ? Math.round(bubbleSize * 0.58) : 26;
      const waSvg = '<svg viewBox="0 0 32 32" width="' + iconSize + '" height="' + iconSize + '" fill="#ffffff" style="display:block;flex-shrink:0;">'
        + '<path d="M16.04 4C9.96 4 5 8.95 5 15.02c0 2.65.78 5.1 2.12 7.17L5 28l5.98-2.06a11.9 11.9 0 0 0 5.06 1.13h.01C22.12 27.07 27 22.12 27 16.04 27 9.96 22.12 4 16.04 4zm0 21.2h-.01a9.9 9.9 0 0 1-5.04-1.38l-.36-.21-3.55 1.22 1.2-3.46-.23-.36a9.86 9.86 0 0 1-1.51-5.25c0-5.46 4.45-9.9 9.92-9.9 2.65 0 5.13 1.03 7 2.9a9.82 9.82 0 0 1 2.9 7c-.01 5.46-4.46 9.9-9.92 9.9zm5.44-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/>'
        + '</svg>';

      const el = document.createElement('a');
      el.id = 'hichroney-whatsapp-launcher';
      el.href = waUrl;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.setAttribute('aria-label', label);

      if (aiAlsoShown) {
        // Round icon matching the AI bubble's size/shape.
        el.innerHTML = waSvg;
        el.style.cssText = 'position: fixed;' + verticalCss + horizontalCss
          + 'width:' + bubbleSize + 'px;height:' + bubbleSize + 'px;border-radius:50%;'
          + 'background:' + waColor + ';display:flex;align-items:center;justify-content:center;'
          + 'box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:999999;cursor:pointer;text-decoration:none;'
          + 'transition:transform 0.2s, box-shadow 0.2s;';
      } else {
        // Full pill with the configured label.
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        iconWrap.innerHTML = waSvg;
        const textSpan = document.createElement('span');
        textSpan.textContent = label;
        textSpan.style.cssText = 'white-space:nowrap;';
        el.appendChild(iconWrap);
        el.appendChild(textSpan);
        el.style.cssText = 'position: fixed;' + verticalCss + horizontalCss
          + 'height:56px;padding:0 22px 0 16px;border-radius:32px;'
          + 'background:' + waColor + ';display:flex;align-items:center;gap:10px;'
          + 'box-shadow:0 4px 14px rgba(0,0,0,0.18);z-index:999999;cursor:pointer;text-decoration:none;'
          + "color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
          + 'font-size:15px;font-weight:500;transition:transform 0.2s, box-shadow 0.2s;';
      }

      el.addEventListener('mouseenter', function() { el.style.transform = 'scale(1.05)'; });
      el.addEventListener('mouseleave', function() { el.style.transform = 'scale(1)'; });

      document.body.appendChild(el);
      console.log('[Hi Chroney] WhatsApp launcher rendered (' + (aiAlsoShown ? 'both' : 'whatsapp-only') + ' mode)');
    },

    createWidget: function() {
      const baseUrl = this.getBaseUrl();
      
      // Parse position and size settings
      const position = this.config.widgetPosition || 'bottom-right';
      const [verticalPos, horizontalPos] = position.split('-');
      const bubbleSize = parseInt(this.config.bubbleSize, 10) || 60;
      const bottomOffset = parseInt(this.config.pillBottomOffset, 10) || 20;
      const sideOffset = parseInt(this.config.pillSideOffset, 10) || 20;
      
      // Set position styles based on configuration
      const positionStyles = {
        vertical: verticalPos === 'top' ? 'top: ' + bottomOffset + 'px;' : 'bottom: ' + bottomOffset + 'px;',
        horizontal: horizontalPos === 'right' ? 'right: ' + sideOffset + 'px;' : 'left: ' + sideOffset + 'px;',
        iframeVertical: verticalPos === 'top' ? 'top: ' + bottomOffset + 'px;' : 'bottom: ' + bottomOffset + 'px;',
        iframeHorizontal: horizontalPos === 'right' ? 'right: ' + sideOffset + 'px;' : 'left: ' + sideOffset + 'px;'
      };
      
      // Add responsive styles to head
      const responsiveStyles = document.createElement('style');
      responsiveStyles.textContent = `
        /* Futuristic chat opening animation */
        @keyframes hichroney-chat-open {
          0% {
            opacity: 0;
            transform: scale(0.8) translateY(20px);
            filter: blur(10px);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.02) translateY(-5px);
            filter: blur(2px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
            filter: blur(0);
          }
        }
        
        @keyframes hichroney-glow-pulse {
          0%, 100% {
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 0 30px rgba(147, 51, 234, 0.3);
          }
          50% {
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2), 0 0 50px rgba(147, 51, 234, 0.5);
          }
        }
        
        @keyframes hichroney-scan-line {
          0% {
            transform: translateY(-100%);
            opacity: 1;
          }
          100% {
            transform: translateY(100%);
            opacity: 0;
          }
        }
        
        /* Dark overlay when chat is open */
        #hichroney-chat-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 999997;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
        }
        
        #hichroney-chat-overlay.overlay-visible {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
        }
        
        /* Chat opening animation class */
        #hichroney-widget-iframe.chat-opening {
          animation: hichroney-chat-open 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        
        /* Glow effect after opening */
        #hichroney-widget-iframe.chat-open-glow {
          animation: hichroney-glow-pulse 2s ease-in-out 1;
        }
        
        /* Desktop styles */
        #hichroney-widget-container {
          position: fixed;
          ${positionStyles.vertical}
          ${positionStyles.horizontal}
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        #hichroney-widget-iframe {
          display: none;
          position: fixed;
          ${positionStyles.iframeVertical}
          ${positionStyles.iframeHorizontal}
          width: ${this.config.widgetWidth}px;
          height: min(${this.config.widgetHeight}px, calc(100vh - ${bubbleSize + 80}px));
          max-height: calc(100vh - ${bubbleSize + 80}px);
          border: none;
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          z-index: 999998;
          transition: height 0.3s ease-out;
        }
        
        /* Partial mode - compact height showing header + first message + input */
        #hichroney-widget-iframe.partial-mode {
          height: 360px !important;
          max-height: 360px !important;
        }
        
        /* Tablet styles - respect configured size with responsive constraints */
        @media (max-width: 768px) {
          #hichroney-widget-iframe {
            width: min(${this.config.widgetWidth}px, calc(100vw - 20px));
            max-width: calc(100vw - 20px);
            max-height: calc(100vh - 60px);
            ${horizontalPos === 'right' ? 'right: ' + Math.max(sideOffset, 10) + 'px;' : 'left: ' + Math.max(sideOffset, 10) + 'px;'}
            ${verticalPos === 'bottom' ? 'bottom: ' + Math.max(bottomOffset, 10) + 'px;' : 'top: ' + Math.max(bottomOffset, 10) + 'px;'}
          }
          
          #hichroney-widget-container {
            ${horizontalPos === 'right' ? 'right: ' + Math.max(sideOffset, 10) + 'px;' : 'left: ' + Math.max(sideOffset, 10) + 'px;'}
            ${verticalPos === 'bottom' ? 'bottom: ' + Math.max(bottomOffset, 10) + 'px;' : 'top: ' + Math.max(bottomOffset, 10) + 'px;'}
          }
        }
        
        /* Mobile styles - compact floating window by default, fullscreen only with .mobile-open */
        @media (max-width: 480px) {
          /* Default compact floating window on mobile (for auto-open partial mode) */
          #hichroney-widget-iframe {
            width: min(${this.config.widgetWidth}px, calc(100vw - 20px)) !important;
            height: 280px !important;
            max-height: 280px !important;
            max-width: calc(100vw - 20px) !important;
            ${horizontalPos === 'right' ? 'right: ' + Math.max(sideOffset, 10) + 'px !important;' : 'left: ' + Math.max(sideOffset, 10) + 'px !important;'}
            ${verticalPos === 'bottom' ? 'bottom: ' + (bubbleSize + bottomOffset) + 'px !important;' : 'top: ' + (bubbleSize + bottomOffset) + 'px !important;'}
            border-radius: 12px !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
            z-index: 999998 !important;
          }
          
          /* When auto-opened on mobile: position at bottom edge and hide button */
          #hichroney-widget-iframe.mobile-partial-open {
            /* Position above the browser's bottom bar with safe area */
            bottom: calc(env(safe-area-inset-bottom, 0px) + 60px) !important;
            left: 5px !important;
            right: 5px !important;
            width: calc(100vw - 10px) !important;
            max-width: calc(100vw - 10px) !important;
            /* Height to show header + first message + input */
            height: 340px !important;
            max-height: 340px !important;
            border-radius: 16px !important;
          }
          
          /* Hide pill button when chat is auto-opened in partial mode */
          #hichroney-widget-container.mobile-partial-hidden {
            display: none !important;
          }
          
          /* Bottom sheet mode - 80% height with rounded top corners */
          #hichroney-widget-iframe.mobile-open {
            display: block !important;
            width: 100vw !important;
            /* 80% of viewport height for partial overlay */
            height: 80vh !important;
            min-height: 80vh !important;
            max-height: 80vh !important;
            max-width: 100vw !important;
            top: auto !important;
            left: 0 !important;
            right: 0 !important;
            /* Position above browser chrome/safe area so input is fully visible */
            bottom: calc(env(safe-area-inset-bottom, 0px) + 10px) !important;
            transform: none !important;
            /* Rounded corners at top for bottom sheet appearance */
            border-radius: 20px 20px 0 0 !important;
            position: fixed !important;
            /* Subtle shadow for depth */
            box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15) !important;
            overflow: hidden !important;
            /* Prevent any scrolling/bouncing on the iframe itself */
            overscroll-behavior: none !important;
            -webkit-overflow-scrolling: touch !important;
            /* Higher z-index than proactive nudge (999998) to ensure iframe is on top */
            z-index: 999999 !important;
          }
          
          /* Hide widget button when chat is fullscreen on mobile */
          #hichroney-widget-iframe.mobile-open ~ #hichroney-widget-container {
            display: none !important;
          }
          
          #hichroney-widget-container {
            ${horizontalPos === 'right' ? 'right: ' + Math.max(sideOffset, 10) + 'px !important;' : 'left: ' + Math.max(sideOffset, 10) + 'px !important;'}
            ${verticalPos === 'bottom' ? 'bottom: ' + bottomOffset + 'px !important;' : 'top: ' + bottomOffset + 'px !important;'}
            z-index: 2147483647 !important;
            position: fixed !important;
          }
          
          #hichroney-widget-button {
            width: 56px !important;
            height: 56px !important;
          }
          
          #hichroney-widget-button.pill-style:not(.pill-expanded) {
            width: 260px !important;
            max-width: calc(100vw - 40px) !important;
            height: 56px !important;
            transition: width 0.3s ease !important;
          }
          
          #hichroney-widget-button.pill-style {
            display: flex !important;
            align-items: center !important;
            /* CRITICAL: Disable transforms on mobile to prevent touch target misalignment */
            transform: none !important;
            -webkit-transform: none !important;
          }
          
          #hichroney-widget-button.pill-style.pill-expanded {
            width: calc(100vw - 20px) !important;
            max-width: calc(100vw - 20px) !important;
            height: 56px !important;
            /* CRITICAL: Ensure no transforms when expanded */
            transform: none !important;
            -webkit-transform: none !important;
          }
          
          /* When expanded on mobile, maximize input field space */
          #hichroney-widget-button.pill-style.pill-expanded {
            justify-content: flex-start !important; /* Force left alignment */
            padding: 0 4px !important; /* Minimal outer padding - reduced from 6px */
          }
          
          #hichroney-widget-button.pill-style.pill-expanded .pill-wrapper {
            flex: 1 !important;
            padding: 0 !important;
            gap: 4px !important; /* Reduced from 6px */
            margin: 0 !important;
            width: 100% !important; /* Ensure wrapper fills button */
          }
          
          #hichroney-widget-button.pill-style.pill-expanded .pill-avatar {
            margin: 0 !important;
            flex-shrink: 0 !important;
            flex-grow: 0 !important;
          }
          
          #hichroney-widget-button.pill-style.pill-expanded .pill-input-container {
            flex: 1 1 0px !important; /* flex-basis: 0 forces it to ignore intrinsic width */
            min-width: 0 !important;
            max-width: none !important;
            width: auto !important; /* Let flex handle the width */
            padding: 8px 8px !important; /* Reduced horizontal padding from 12px to 8px */
            gap: 4px !important; /* Reduced from 6px */
            margin: 0 !important;
          }
          
          #hichroney-widget-button.pill-style.pill-expanded #hichroney-pill-input {
            flex: 1 1 0px !important; /* flex-basis: 0 */
            width: auto !important;
            min-width: 0 !important;
          }
          
          #hichroney-widget-button.pill-style.pill-expanded #hichroney-pill-send-btn {
            flex: 0 0 auto !important; /* Don't grow or shrink */
          }
          
          #hichroney-widget-button.pill-style.pill-expanded .pill-arrow-button,
          #hichroney-widget-button.pill-style.pill-expanded #hichroney-pill-send-btn {
            margin: 0 !important;
          }
          
          /* Default collapsed state spacing (only when NOT expanded) */
          #hichroney-widget-button.pill-style:not(.pill-expanded) .pill-wrapper {
            padding: 0 10px !important;
            gap: 8px !important;
          }
          
          #hichroney-widget-button.pill-style:not(.pill-expanded) .pill-input-container {
            padding: 8px 12px !important;
            gap: 6px !important;
          }
          
          #hichroney-widget-button.pill-style .pill-avatar {
            width: 36px !important;
            height: 36px !important;
            flex-shrink: 0 !important;
          }
          
          #hichroney-widget-button.pill-style .pill-avatar img,
          #hichroney-widget-button.pill-style .pill-avatar svg {
            width: 36px !important;
            height: 36px !important;
          }
          
          /* Fix close button avatar on mobile */
          #hichroney-widget-button.pill-style img[style*="width: 48px"],
          #hichroney-widget-button.pill-style svg[style*="width: 48px"] {
            width: 36px !important;
            height: 36px !important;
          }
          
          /* Removed duplicate - defined above */
          
          #hichroney-widget-button.pill-style #hichroney-pill-input {
            font-size: 14px !important;
          }
          
          #hichroney-widget-button.pill-style #hichroney-pill-send-btn {
            width: 32px !important;
            height: 32px !important;
          }
          
          #hichroney-widget-button.pill-style #hichroney-pill-send-btn svg {
            width: 14px !important;
            height: 14px !important;
          }
          
          #hichroney-widget-button.pill-style svg,
          #hichroney-widget-button.pill-style img {
            width: 20px !important;
            height: 20px !important;
          }
          
          #hichroney-widget-button.pill-style span {
            font-size: 13px !important;
          }
        }
        
        /* Pill state management with smooth transitions (global - applies to all screen sizes) */
        #hichroney-widget-button.pill-style.pill--hidden {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
          transform: translateY(8px) !important;
          visibility: hidden !important;
        }
        
        #hichroney-widget-button.pill-style.pill--visible {
          opacity: 1 !important;
          pointer-events: auto !important;
          transform: translateY(0) !important;
          transition: opacity 180ms ease, transform 180ms ease !important;
        }
        
        #hichroney-widget-button.pill-style.pill--input .pill-state--close,
        #hichroney-widget-button.pill-style.pill--close .pill-state--input {
          display: none !important;
        }
        
        /* Default desktop pill layout and spacing */
        #hichroney-widget-button.pill-style {
          display: flex !important;
          align-items: center !important;
          justify-content: flex-start !important; /* Left-align content */
        }
        
        /* Desktop wrapper spacing - DO NOT apply when expanded on mobile */
        #hichroney-widget-button.pill-style:not(.pill-expanded) .pill-wrapper {
          padding: 0 10px;
          gap: 8px;
        }
        
        /* Base wrapper styles for all states */
        #hichroney-widget-button.pill-style .pill-wrapper {
          display: flex !important;
          align-items: center !important; /* Center-align avatar and content */
          width: 100% !important;
          position: relative !important;
          box-sizing: border-box !important;
        }
        
        #hichroney-widget-button.pill-style .pill-avatar {
          flex-shrink: 0 !important;
        }
        
        /* Desktop/collapsed state only - DO NOT apply when expanded */
        #hichroney-widget-button.pill-style:not(.pill-expanded) .pill-input-container {
          flex: 1 !important;
          min-width: 0 !important;
          background: white !important;
          border-radius: 24px !important;
          display: flex !important;
          align-items: center !important; /* Center-align send button */
          box-sizing: border-box !important;
          padding: 10px 16px;
          gap: 8px;
        }
        
        /* Base styles shared by both states */
        #hichroney-widget-button.pill-style .pill-input-container {
          background: white !important;
          border-radius: 24px !important;
          display: flex !important;
          align-items: center !important; /* Center-align send button */
          box-sizing: border-box !important;
        }
        
        /* Textarea field styling (auto-expanding) - DO NOT apply flex/width when expanded on mobile */
        #hichroney-widget-button.pill-style:not(.pill-expanded) #hichroney-pill-input {
          flex: 1 !important;
          min-width: 0 !important;
          width: 100% !important;
        }
        
        /* Base textarea styles for all states */
        #hichroney-pill-input {
          min-height: 20px !important;
          max-height: 48px !important; /* ~2 lines max before scrolling */
          font-size: 15px !important;
          font-weight: 400 !important;
          color: #000 !important;
          background: transparent !important;
          border: none !important;
          outline: none !important;
          text-align: left !important;
          letter-spacing: 0.3px !important;
          line-height: 1.4 !important;
          resize: none !important;
          overflow-y: auto !important;
          box-sizing: border-box !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        }
        
        /* Send button styling */
        #hichroney-pill-send-btn {
          flex-shrink: 0 !important;
          width: 36px !important;
          height: 36px !important;
          border-radius: 50% !important;
          background: #000 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          transition: background 0.2s !important;
          border: none !important;
          cursor: pointer !important;
          padding: 0 !important;
        }
        
        /* Hide conversation starters on mobile to prevent screen coverage */
        @media (max-width: 480px) {
          #hichroney-starters-container {
            display: none !important;
          }
          
          /* CRITICAL: Disable ALL transform-based animations on mobile */
          /* CSS transforms cause touch target misalignment on mobile browsers */
          #hichroney-widget-button,
          #hichroney-widget-container,
          .pill-wrapper,
          .pill-input-container,
          #hichroney-pill-input,
          #hichroney-pill-send-btn {
            transform: none !important;
            -webkit-transform: none !important;
            animation: none !important;
            -webkit-animation: none !important;
          }
        }
        
        /* Animations - only apply on devices with hover (not touch) */
        @media (hover: hover) {
          @keyframes hichroney-bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
        }
        
        /* Fallback for devices without hover capability */
        @media (hover: none) {
          @keyframes hichroney-bounce {
            0%, 100% { transform: none; }
          }
        }
        
        /* Original animation definition for backward compatibility */
        @keyframes hichroney-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes hichroney-avatar-pulse {
          0%, 100% { 
            box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7),
                        0 0 20px rgba(255, 255, 255, 0.3);
            transform: scale(1);
          }
          50% { 
            box-shadow: 0 0 0 8px rgba(255, 255, 255, 0),
                        0 0 30px rgba(255, 255, 255, 0.5);
            transform: scale(1.05);
          }
        }
        
        /* Pill button arrow hover effect */
        #hichroney-widget-button:hover .pill-arrow-button {
          background: #222 !important;
        }
        
        #hichroney-widget-button:active .pill-arrow-button {
          background: #111 !important;
        }
        
        /* Force arrow icon to always be white */
        .pill-arrow-button svg {
          stroke: white !important;
          fill: none !important;
        }
        
        /* Pill input field styling */
        #hichroney-pill-input::placeholder {
          color: transparent;
        }
        
        #hichroney-pill-input:focus::placeholder {
          color: transparent;
        }
        
        /* Animated placeholder styling */
        .pill-animated-placeholder {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: rgba(51, 51, 51, 0.5);
          font-size: 13px;
          font-weight: 400;
          pointer-events: none;
          white-space: nowrap;
          overflow: hidden;
          transition: opacity 0.2s;
        }
        
        .pill-animated-placeholder.hidden {
          opacity: 0;
        }
        
        /* Typing cursor animation */
        .pill-animated-placeholder .typing-cursor {
          display: inline-block;
          width: 1px;
          height: 14px;
          background: rgba(51, 51, 51, 0.5);
          margin-left: 1px;
          animation: blink-cursor 0.8s step-end infinite;
          vertical-align: middle;
        }
        
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        
        /* ============================================================
           MOBILE PILL EXPANDED STATE - PLACED LAST TO WIN CSS CASCADE
           These rules MUST be at the end to override all desktop rules
           ============================================================ */
        @media (max-width: 480px) {
          /* Button expands to near full width */
          #hichroney-widget-button.pill-style.pill-expanded {
            width: calc(100vw - 20px) !important;
            max-width: calc(100vw - 20px) !important;
            height: auto !important;
            min-height: 56px !important;
            justify-content: flex-start !important;
            padding: 4px !important;
          }
          
          /* STATE WRAPPER must fill entire button width */
          #hichroney-widget-button.pill-style.pill-expanded .pill-state--input {
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-sizing: border-box !important;
          }
          
          /* Wrapper fills the button and uses flex layout */
          #hichroney-widget-button.pill-style.pill-expanded .pill-wrapper {
            display: flex !important;
            flex: 1 1 auto !important;
            width: 100% !important;
            padding: 0 4px !important;
            gap: 8px !important;
            margin: 0 !important;
            align-items: center !important;
            box-sizing: border-box !important;
          }
          
          /* Avatar stays fixed size on the left */
          #hichroney-widget-button.pill-style.pill-expanded .pill-avatar {
            flex: 0 0 36px !important;
            width: 36px !important;
            height: 36px !important;
            margin: 0 !important;
          }
          
          /* Input container MUST expand to fill remaining space */
          #hichroney-widget-button.pill-style.pill-expanded .pill-input-container {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            max-width: none !important;
            width: auto !important;
            padding: 8px 12px !important;
            gap: 8px !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center !important;
            background: white !important;
            border-radius: 24px !important;
            box-sizing: border-box !important;
          }
          
          /* Textarea MUST expand within the container */
          #hichroney-widget-button.pill-style.pill-expanded #hichroney-pill-input {
            flex: 1 1 auto !important;
            min-width: 0 !important;
            max-width: none !important;
            width: auto !important;
          }
          
          /* Send button stays fixed size */
          #hichroney-widget-button.pill-style.pill-expanded #hichroney-pill-send-btn {
            flex: 0 0 32px !important;
            width: 32px !important;
            height: 32px !important;
            margin: 0 !important;
          }
        }
      `;
      document.head.appendChild(responsiveStyles);
      
      // Create container
      const container = document.createElement('div');
      container.id = 'hichroney-widget-container';

      // Create dark overlay for when chat is open
      const chatOverlay = document.createElement('div');
      chatOverlay.id = 'hichroney-chat-overlay';
      document.body.appendChild(chatOverlay);
      
      // Helper functions to show/hide overlay
      const showOverlay = () => {
        chatOverlay.classList.add('overlay-visible');
      };
      
      const hideOverlay = () => {
        chatOverlay.classList.remove('overlay-visible');
      };
      
      // Click on overlay closes the chat (unless proactive guidance is active)
      chatOverlay.addEventListener('click', () => {
        if (isOpen) {
          // For proactive guidance pages, don't close on overlay click
          if (HiChroneyWidget.config.proactiveGuidanceActive === true) {
            console.log('[Hi Chroney] Proactive guidance active - ignoring overlay click');
            return;
          }
          // Trigger close via button click simulation
          button.click();
        }
      });

      // ─── OTP UX ownership (Task #14) ────────────────────────────────────────
      // The actual chat composer for the widget lives INSIDE the embedded iframe
      // (rendered by client/src/pages/EmbedChat.tsx). All Task #14 OTP UX —
      // digits-only mode, maxLength=6, paste sanitization, send-disabled-until-
      // exactly-6-digits, and the lockout countdown banner — is implemented there
      // and driven by the server's `otp_state` SSE event + `awaiting_otp` /
      // `locked_until` chat-response metadata. This widget.js file only renders
      // the iframe shell + launcher button; it has no chat composer of its own,
      // so there is intentionally nothing for it to wire up for OTP state.
      // ────────────────────────────────────────────────────────────────────────
      // Create iframe for the chat widget
      const iframe = document.createElement('iframe');
      iframe.id = 'hichroney-widget-iframe';
      
      // Grant microphone and autoplay permissions for voice mode
      iframe.setAttribute('allow', 'microphone; autoplay');
      
      // Iframe readiness tracking for reliable message delivery
      // IMPORTANT: Set up listener BEFORE setting iframe.src to avoid race condition
      let isIframeReady = false;
      const messageQueue = [];
      
      // Listen for EMBED_READY signal from iframe
      window.addEventListener('message', (event) => {
        // Debug logging for all messages
        if (event.data && event.data.type === 'EMBED_READY') {
          console.log('[Hi Chroney Widget] 📩 Received EMBED_READY signal');
          console.log('[Hi Chroney Widget] event.source:', event.source);
          console.log('[Hi Chroney Widget] iframe.contentWindow:', iframe.contentWindow);
          console.log('[Hi Chroney Widget] Are they equal?', event.source === iframe.contentWindow);
        }
        
        // Verify message is from our iframe to prevent spoofing
        // Only check if iframe is appended to DOM (contentWindow exists)
        if (iframe.contentWindow && event.source !== iframe.contentWindow) {
          return;
        }
        
        if (event.data && event.data.type === 'OPEN_URL' && event.data.url) {
          window.open(event.data.url, '_blank', 'noopener,noreferrer');
          return;
        }

        if (event.data && event.data.type === 'EMBED_READY') {
          console.log('[Hi Chroney Widget] ✅ Iframe is ready to receive messages');
          isIframeReady = true;
          HiChroneyWidget._iframeReady = true;
          
          if (window.VisitorSession && window.VisitorSession.sessionId) {
            console.log('[Hi Chroney Widget] Sending visitor session ID to iframe:', window.VisitorSession.sessionId);
            iframe.contentWindow.postMessage({
              type: 'SESSION_INIT',
              visitorSessionId: window.VisitorSession.sessionId
            }, '*');
          }
          
          // Send parent page URL to iframe for lead source tracking (LeadSquared integration)
          // This is critical because document.referrer is unreliable in iframes
          console.log('[Hi Chroney Widget] Sending parent page URL to iframe:', window.location.href);
          iframe.contentWindow.postMessage({
            type: 'PARENT_URL',
            pageUrl: window.location.href
          }, '*');
          
          // Process any queued messages
          console.log(`[Hi Chroney Widget] Processing ${messageQueue.length} queued message(s)`);
          while (messageQueue.length > 0) {
            const queuedMessage = messageQueue.shift();
            console.log('[Hi Chroney Widget] ✅ Sending queued message:', queuedMessage);
            iframe.contentWindow.postMessage(queuedMessage, '*');
          }
          
          // Process proactive guidance rules (use prefetched if available, otherwise fetch)
          const currentUrl = window.location.pathname + window.location.search;
          const businessAccountId = HiChroneyWidget.config.businessAccountId;
          
          const processGuidanceRules = function(rules) {
            console.log('[Hi Chroney Widget] Processing', rules?.length || 0, 'guidance rules');
            if (!rules || rules.length === 0) return;
            
            // Find matching rule using same logic as URL change handler
            var matchingRule = null;
            for (var i = 0; i < rules.length; i++) {
              var rule = rules[i];
              var pattern = rule.urlPattern;
              
              // Exact match
              if (pattern === currentUrl) {
                matchingRule = rule;
                break;
              }
              
              // Wildcard pattern match
              if (pattern.includes('*')) {
                var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                var regexPattern = escaped.replace(/\*/g, '.*');
                var regex = new RegExp('^' + regexPattern + '$');
                if (regex.test(currentUrl)) {
                  matchingRule = rule;
                  break;
                }
              }
              
              // Prefix match
              if (currentUrl.startsWith(pattern)) {
                matchingRule = rule;
                break;
              }
            }
            
            if (matchingRule && matchingRule.message) {
              console.log('[Hi Chroney Widget] Found matching guidance rule:', matchingRule.name);
              
              // CRITICAL: Set proactiveGuidanceActive flag when rule matches
              // This enables assistant mode: no overlay, prevents closing
              HiChroneyWidget.config.proactiveGuidanceActive = true;
              console.log('[Hi Chroney Widget] ✅ Proactive guidance mode ACTIVATED');
              
              // Hide any existing overlay for assistant mode (no blocking overlay)
              if (chatOverlay) {
                chatOverlay.classList.remove('overlay-visible');
              }
              
              // Ensure chat is open and visible for proactive guidance
              if (iframe) {
                iframe.style.display = 'block';
              }
              
              // Build guidance payload
              var guidancePayload = {
                type: 'PROACTIVE_GUIDANCE',
                message: matchingRule.message,
                clearHistory: true,
                cleanMode: matchingRule.cleanMode === true
              };
              
              // Include conversation starters (FAQs) if defined
              if (matchingRule.conversationStarters) {
                try {
                  var ruleFaqs = typeof matchingRule.conversationStarters === 'string'
                    ? JSON.parse(matchingRule.conversationStarters)
                    : matchingRule.conversationStarters;
                  if (Array.isArray(ruleFaqs)) {
                    guidancePayload.conversationStarters = ruleFaqs;
                    console.log('[Hi Chroney Widget] Including FAQs:', ruleFaqs.length);
                  }
                } catch (e) {
                  console.warn('[Hi Chroney Widget] Failed to parse FAQs:', e);
                }
              }
              
              // Send to iframe
              iframe.contentWindow.postMessage(guidancePayload, '*');
              console.log('[Hi Chroney Widget] Sent PROACTIVE_GUIDANCE message');
            } else {
              console.log('[Hi Chroney Widget] No matching guidance rule for URL:', currentUrl);
            }
          };
          
          // Fetch guidance rules and process
          console.log('[Hi Chroney Widget] Fetching proactive guidance rules for URL:', currentUrl);
          fetch(HiChroneyWidget.getBaseUrl() + '/api/public/proactive-guidance-rules/' + encodeURIComponent(businessAccountId))
            .then(function(r) { return r.json(); })
            .then(processGuidanceRules)
            .catch(function(err) {
              console.log('[Hi Chroney Widget] Failed to fetch guidance rules:', err);
            });
        }
      });
      
      // Build iframe URL with config AFTER setting up listener
      // Use /embed/chat directly to avoid nested iframe issues
      const iframeUrl = new URL(`${baseUrl}/embed/chat`);
      iframeUrl.searchParams.set('businessAccountId', this.config.businessAccountId);
      
      // Pass parent page URL to iframe for proactive guidance matching
      // This is needed because document.referrer is empty for same-origin iframes
      const parentPageUrl = window.location.pathname + window.location.search;
      iframeUrl.searchParams.set('sourceUrl', parentPageUrl);

      // Secure mode (TopScholar): forward the signed launch token. When the account
      // requires a signed token, the server trusts ONLY this and ignores the plain
      // board/medium/grade/subject params below.
      if (this.config.topscholarToken) iframeUrl.searchParams.set('token', this.config.topscholarToken);

      // Grade-scoped widget (TopScholar / K12): forward the student's board/medium/grade
      // (if the host portal injected them) so curriculum answers stay within their grade.
      if (this.config.studentBoard) iframeUrl.searchParams.set('board', this.config.studentBoard);
      if (this.config.studentMedium) iframeUrl.searchParams.set('medium', this.config.studentMedium);
      if (this.config.studentGrade) iframeUrl.searchParams.set('grade', this.config.studentGrade);
      if (this.config.studentSubject) iframeUrl.searchParams.set('subject', this.config.studentSubject);
      if (this.config.studentChapter) iframeUrl.searchParams.set('chapter', this.config.studentChapter);

      // Grade-scoped student identity (plain, non-secure). Forwarded so history,
      // conversation listing, and per-student attribution work like the signed
      // embed. A signed token (forwarded above) always wins server-side.
      if (this.config.studentId) iframeUrl.searchParams.set('studentId', this.config.studentId);
      if (this.config.studentName) iframeUrl.searchParams.set('name', this.config.studentName);
      
      // Set iframe src immediately - guidance mode is handled by separate /embed/guidance route
      iframe.src = iframeUrl.toString();

      // ─── Inline embed mode (TopScholar / K12 only) ──────────────────────────
      // When the host portal opts in with data-mode="inline" AND this account has
      // K12 education enabled, render the tutor iframe INSIDE a host container
      // element (filling it 100% x 100%) instead of as a floating bubble. There is
      // no launcher button, no overlay, no open/close — the chat IS the page.
      // Gated on k12EducationEnabled: any non-K12 account that sets data-mode falls
      // through to the normal floating widget below. The container defaults to the
      // id "ai-tutor" and, if it is missing from the DOM, we fall back to the
      // floating widget rather than silently rendering nothing.
      if (this.config.mode === 'inline' && this.config.k12EducationEnabled === true) {
        const containerId = this.config.container || 'ai-tutor';
        const host = document.getElementById(containerId);
        if (host) {
          // Distinct id so NONE of the #hichroney-widget-iframe float/mobile rules
          // (including the mobile !important overrides) apply — we own the styling.
          iframe.id = 'hichroney-inline-iframe';
          iframe.style.cssText = [
            'display: block',
            'width: 100%',
            'height: 100%',
            'min-height: 100%',
            'border: none',
            'margin: 0',
            'padding: 0',
          ].join('; ') + ';';
          // Ensure the host can actually give the iframe a height to fill.
          if (getComputedStyle(host).position === 'static') {
            host.style.position = 'relative';
          }
          host.appendChild(iframe);

          // Minimal messaging shim so any caller of _sendMessageToIframe is safe.
          HiChroneyWidget._sendMessageToIframe = (messageData) => {
            if (isIframeReady && iframe.contentWindow) {
              iframe.contentWindow.postMessage(messageData, '*');
            } else {
              messageQueue.push(messageData);
            }
          };

          console.log('[Hi Chroney Widget] Inline mode active — mounted into #' + containerId);
          return;
        }
        console.warn('[Hi Chroney Widget] Inline mode requested but container #' + containerId + ' not found; falling back to floating widget.');
      }
      // ────────────────────────────────────────────────────────────────────────

      // NOTE: Iframe stays hidden (display:none in CSS) until user opens chat
      // The prewarmCache function handles preloading settings/intro via HTTP cache
      console.log('[Hi Chroney Widget] Iframe created, will load when displayed');
      
      // Helper function to send messages to iframe with queuing
      const sendMessageToIframe = (messageData) => {
        if (isIframeReady) {
          console.log('[Hi Chroney Widget] Sending message immediately:', messageData);
          iframe.contentWindow.postMessage(messageData, '*');
        } else {
          console.log('[Hi Chroney Widget] Iframe not ready, queuing message:', messageData);
          messageQueue.push(messageData);
        }
      };
      
      // Expose sendMessageToIframe for Product Page AI Mode
      HiChroneyWidget._sendMessageToIframe = sendMessageToIframe;

      // Normalize settings to lowercase to handle case sensitivity from API
      // MUST come before button creation since we use buttonStyle in createElement
      const buttonStyle = (this.config.buttonStyle || 'circular').toLowerCase().trim();
      const buttonAnimation = (this.config.buttonAnimation || 'bounce').toLowerCase().trim();
      
      const gradientStyle = `linear-gradient(135deg, ${this.config.chatColor}, ${this.config.chatColorEnd})`;

      // Create chat button (or input container for pill style)
      const button = document.createElement(buttonStyle === 'pill' ? 'div' : 'button');
      button.id = 'hichroney-widget-button';
      
      // Helper function to get avatar HTML or fallback icon
      const getAvatarOrIcon = (size = 24, addAnimation = false) => {
        const avatarType = this.config.avatarType;
        const avatarUrl = this.config.avatarUrl;
        
        if (avatarType && avatarType !== 'none') {
          let imgSrc;
          if (avatarType === 'custom') {
            imgSrc = avatarUrl;
          } else {
            imgSrc = `${baseUrl}/avatars/avatar-${avatarType.replace('preset-', '')}.png`;
          }
          return `<img src="${imgSrc}" alt="AI Assistant" style="width: ${size}px; height: ${size}px; border-radius: 50%; object-fit: cover; display: block;" />`;
        } else {
          return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>`;
        }
      };
      
      // Calculate avatar size: 90% of bubble when avatar is selected, otherwise use default icon size
      const avatarSize = (this.config.avatarType && this.config.avatarType !== 'none') 
        ? Math.round(bubbleSize * 0.9) 
        : 28;
      
      button.innerHTML = getAvatarOrIcon(avatarSize, true);

      // Map button styles to border-radius and size
      let buttonStyles = {};
      switch (buttonStyle) {
        case 'circular':
          buttonStyles = { borderRadius: '50%', width: `${bubbleSize}px`, height: `${bubbleSize}px`, padding: '0' };
          break;
        case 'rounded':
          buttonStyles = { borderRadius: '16px', width: `${bubbleSize}px`, height: `${bubbleSize}px`, padding: '0' };
          break;
        case 'pill':
          const pillHeight = 64;
          buttonStyles = { borderRadius: '32px', width: '280px', height: `${pillHeight}px`, padding: '0' };
          break;
        case 'minimal':
          buttonStyles = { borderRadius: '8px', width: `${Math.floor(bubbleSize * 0.93)}px`, height: `${Math.floor(bubbleSize * 0.93)}px`, padding: '0' };
          break;
        default:
          buttonStyles = { borderRadius: '50%', width: `${bubbleSize}px`, height: `${bubbleSize}px`, padding: '0' };
      }
      
      // Map animations to CSS animation property
      let animationStyle = '';
      let transitionStyle = 'transition: transform 0.2s, box-shadow 0.2s;';
      switch (buttonAnimation) {
        case 'bounce':
          animationStyle = 'animation: hichroney-bounce 2s ease-in-out infinite;';
          break;
        case 'none':
        default:
          animationStyle = '';
      }
      
      console.log('[Hi Chroney Widget] Button style:', buttonStyle, 'Animation:', buttonAnimation);
      
      // For pill buttons, let CSS handle layout (don't apply center alignment)
      if (buttonStyle === 'pill') {
        button.style.cssText = `
          width: ${buttonStyles.width};
          height: ${buttonStyles.height};
          border-radius: ${buttonStyles.borderRadius};
          background: ${gradientStyle};
          border: none;
          cursor: pointer;
          color: white;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          ${transitionStyle}
          ${animationStyle}
        `;
      } else {
        button.style.cssText = `
          width: ${buttonStyles.width};
          height: ${buttonStyles.height};
          padding: ${buttonStyles.padding};
          border-radius: ${buttonStyles.borderRadius};
          background: ${gradientStyle};
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          ${transitionStyle}
          ${animationStyle}
        `;
      }

      // Helper function to generate pill markup with both states (rendered once)
      const getPillMarkup = () => {
        const pillAvatarSize = 48;
        
        return `
          <div class="pill-state--input">
            <div class="pill-wrapper">
              <div class="pill-avatar">
                ${getAvatarOrIcon(pillAvatarSize, true)}
              </div>
              <div class="pill-input-container" style="position: relative;">
                <span id="hichroney-animated-placeholder" class="pill-animated-placeholder">
                  <span class="placeholder-text"></span><span class="typing-cursor"></span>
                </span>
                <textarea 
                  id="hichroney-pill-input"
                  placeholder=""
                  rows="1"
                ></textarea>
                <button 
                  id="hichroney-pill-send-btn"
                  class="pill-arrow-button"
                  aria-label="Send message"
                >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top: -1px;">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              </button>
            </div>
          </div>
          <div class="pill-state--close" style="display: none;">
            <div style="display: flex; align-items: center; width: 100%; gap: 10px; position: relative; cursor: pointer; padding: 8px;">
              <div style="flex-shrink: 0;">
                ${getAvatarOrIcon(pillAvatarSize, true)}
              </div>
              <span style="
                flex: 1;
                font-size: 15px;
                font-weight: 400;
                color: rgba(255, 255, 255, 0.9);
                text-align: left;
                letter-spacing: 0.3px;
              ">Close Chat</span>
              <div style="
                flex-shrink: 0;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.25);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
              " class="pill-arrow-button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </div>
            </div>
          </div>
        `;
      };
      
      // Function to handle sending messages from pill input
      // Auto-resize textarea based on content
      const autosizeTextarea = (textarea) => {
        if (!textarea) return;
        
        // Reset height to auto to get the correct scrollHeight
        textarea.style.height = 'auto';
        
        // Set height to scrollHeight (content height)
        const newHeight = Math.min(textarea.scrollHeight, 48); // Max 48px (~2 lines)
        textarea.style.height = newHeight + 'px';
        
        // Enable scrolling if content exceeds max height
        if (textarea.scrollHeight > 48) {
          textarea.style.overflowY = 'auto';
        } else {
          textarea.style.overflowY = 'hidden';
        }
      };

      const handlePillSendMessage = () => {
        console.log('[Hi Chroney Pill] Button clicked! isOpen:', isOpen);
        
        const pillInput = document.getElementById('hichroney-pill-input');
        if (!pillInput) {
          console.log('[Hi Chroney Pill] No input found!');
          return;
        }
        
        const message = pillInput.value.trim();
        console.log('[Hi Chroney Pill] Message:', message);
        
        // Always open chat when button is clicked - even if already "open" in partial mode
        if (!isOpen || isPartialMode) {
          console.log('[Hi Chroney Pill] Opening full chat view... (was open:', isOpen, 'partial:', isPartialMode, ')');
          isOpen = true;
          iframe.style.display = 'block';
          
          // Play AI activation sound if enabled
          if (HiChroneyWidget.config.openingSoundEnabled !== 'false') {
            playOpeningSound(HiChroneyWidget.config.openingSoundStyle || 'chime');
          }
          
          // Track chat opened event (fire-and-forget)
          if (HiChroneyWidget.visitorToken) {
            fetch(`${HiChroneyWidget.getBaseUrl()}/api/widget/chat-opened`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                businessAccountId: HiChroneyWidget.config.businessAccountId,
                visitorToken: HiChroneyWidget.visitorToken
              })
            }).catch(() => {});
          }
          iframe.classList.remove('partial-mode');
          isPartialMode = false;
          
          // Add futuristic opening animation
          iframe.classList.add('chat-opening');
          setTimeout(() => {
            iframe.classList.remove('chat-opening');
            iframe.classList.add('chat-open-glow');
            setTimeout(() => {
              iframe.classList.remove('chat-open-glow');
            }, 2000);
          }, 500);
          
          // Show dark overlay behind chat
          showOverlay();
          
          const isMobile = window.innerWidth <= 480;
          
          sessionStorage.removeItem(closedSessionKey);
          
          // Hide button completely when chat opens (mobile and desktop)
          hideButtonCompletely(button);
          console.log('[Hi Chroney Pill] Chat opened - pill hidden');
          
          if (isMobile) {
            // On mobile: Lock body scroll and go fullscreen
            lockBodyScroll(true); // Lock parent page scroll
            
            // CRITICAL: Ensure iframe is a direct child of body to avoid transform inheritance
            // Host page transforms cause touch target misalignment on mobile
            if (iframe.parentElement !== document.body) {
              console.log('[Hi Chroney] Moving iframe to body for proper mobile touch handling');
              document.body.appendChild(iframe);
            }
            // Also ensure container is direct child of body
            ensureDirectBodyChild(container);
            
            setTimeout(() => {
              iframe.classList.add('mobile-open');
            }, 180);
          }
          
          // Hide starters
          if (widgetStartersContainer) {
            widgetStartersContainer.style.display = 'none';
          }
          
          // Hide proactive nudge immediately when chat opens (prevent touch blocking)
          if (typeof clearAllNudgeTimers === 'function') {
            clearAllNudgeTimers();
          }
          if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
            // On mobile, remove immediately without animation to prevent touch interception
            if (isMobile) {
              proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
            } else {
              proactiveNudgePopup.style.transform = 'translateY(20px)';
              proactiveNudgePopup.style.opacity = '0';
              setTimeout(() => {
                if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
                  proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
                }
              }, 300);
            }
          }
        } else {
          console.log('[Hi Chroney Pill] Chat already fully open');
        }
        
        // Only send message if there's content
        if (message) {
          console.log('[Hi Chroney Pill] Sending message:', message);
          
          sendMessageToIframe({
            type: 'SEND_MESSAGE',
            message: message,
            visitorSessionId: window.VisitorSession?.sessionId || null
          });
          
          // Clear input and reset height
          pillInput.value = '';
          autosizeTextarea(pillInput);
        }
      };
      
      // Animated placeholder for pill input
      const startAnimatedPlaceholder = () => {
        const phrases = [
          'Ask me anything...',
          'How can I help you?',
          'What are you looking for?'
        ];
        let phraseIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        let animationTimer = null;
        
        const placeholderEl = document.getElementById('hichroney-animated-placeholder');
        const textEl = placeholderEl?.querySelector('.placeholder-text');
        const inputEl = document.getElementById('hichroney-pill-input');
        
        if (!placeholderEl || !textEl || !inputEl) {
          // Retry after a short delay if elements aren't ready
          setTimeout(startAnimatedPlaceholder, 100);
          return;
        }
        
        // Hide placeholder when input has value or is focused
        const updatePlaceholderVisibility = () => {
          if (inputEl.value.length > 0) {
            placeholderEl.classList.add('hidden');
          } else {
            placeholderEl.classList.remove('hidden');
          }
        };
        
        inputEl.addEventListener('input', updatePlaceholderVisibility);
        inputEl.addEventListener('focus', updatePlaceholderVisibility);
        inputEl.addEventListener('blur', updatePlaceholderVisibility);
        
        const typeAnimation = () => {
          const currentPhrase = phrases[phraseIndex];
          
          if (isDeleting) {
            // Deleting characters
            charIndex--;
            textEl.textContent = currentPhrase.substring(0, charIndex);
            
            if (charIndex === 0) {
              isDeleting = false;
              phraseIndex = (phraseIndex + 1) % phrases.length;
              animationTimer = setTimeout(typeAnimation, 500); // Pause before typing next phrase
            } else {
              animationTimer = setTimeout(typeAnimation, 30); // Faster deletion
            }
          } else {
            // Typing characters
            charIndex++;
            textEl.textContent = currentPhrase.substring(0, charIndex);
            
            if (charIndex === currentPhrase.length) {
              isDeleting = true;
              animationTimer = setTimeout(typeAnimation, 2000); // Pause before deleting
            } else {
              animationTimer = setTimeout(typeAnimation, 50); // Typing speed
            }
          }
        };
        
        // Start the animation
        typeAnimation();
        
        // Store cleanup function
        window.hichroneyPlaceholderCleanup = () => {
          if (animationTimer) clearTimeout(animationTimer);
        };
      };
      
      // Add class for pill style to enable responsive styling
      if (buttonStyle === 'pill') {
        button.classList.add('pill-style', 'pill--visible', 'pill--input');
        button.innerHTML = getPillMarkup();
        
        // Check if form journey is enabled - if so, disable the input field
        // Users can still click to open the chat but can't type
        const checkFormJourneyAndDisableInput = async () => {
          try {
            const baseUrl = HiChroneyWidget.getBaseUrl();
            const businessAccountId = HiChroneyWidget.config.businessAccountId;
            const response = await fetch(`${baseUrl}/api/chat/widget/intro?businessAccountId=${businessAccountId}`);
            if (response.ok) {
              const data = await response.json();
              if (data.formStep) {
                // Form journey is active - disable the input field
                const pillInput = document.getElementById('hichroney-pill-input');
                if (pillInput) {
                  pillInput.disabled = true;
                  pillInput.style.cursor = 'pointer';
                  // Mark that form journey is active so click handler knows to open chat
                  pillInput.dataset.formJourneyActive = 'true';
                  console.log('[Hi Chroney Pill] Form journey active - input disabled');
                  
                  // Hide the send button since input is disabled
                  const sendBtn = document.getElementById('hichroney-pill-send-btn');
                  if (sendBtn) {
                    sendBtn.style.display = 'none';
                  }
                  
                  // Update placeholder to indicate click to open
                  const placeholderEl = document.getElementById('hichroney-animated-placeholder');
                  if (placeholderEl) {
                    const textEl = placeholderEl.querySelector('.placeholder-text');
                    if (textEl) {
                      textEl.textContent = 'Click to get started';
                    }
                    // Stop animation
                    if (window.hichroneyPlaceholderCleanup) {
                      window.hichroneyPlaceholderCleanup();
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.log('[Hi Chroney Pill] Error checking form journey:', err);
          }
        };
        
        // Run the check after a brief delay to let elements be created
        setTimeout(checkFormJourneyAndDisableInput, 200);
        
        // Start animated placeholder after DOM is ready
        setTimeout(startAnimatedPlaceholder, 100);
        
        // Use event delegation on the button container (persists through innerHTML updates)
        button.addEventListener('click', (e) => {
          console.log('[Hi Chroney] Click event on:', e.target.id || e.target.tagName);
          
          // Check if click is on send button or its children (SVG/path)
          const target = e.target;
          const sendBtn = target.closest('#hichroney-pill-send-btn');
          
          if (sendBtn || target.id === 'hichroney-pill-send-btn') {
            console.log('[Hi Chroney] Send button detected!');
            e.stopPropagation();
            e.preventDefault();
            handlePillSendMessage();
            return;
          }
          
          // Prevent clicks on input from bubbling (unless form journey is active - then let it open chat)
          const input = target.closest('#hichroney-pill-input');
          if (input || target.id === 'hichroney-pill-input') {
            const pillInput = document.getElementById('hichroney-pill-input');
            // If form journey is active, don't stop propagation - let click open the chat
            if (pillInput && pillInput.dataset.formJourneyActive === 'true') {
              console.log('[Hi Chroney] Form journey active - letting click open chat');
              // Don't return or stop propagation - let handlePillAvatarClick handle it
            } else {
              e.stopPropagation();
              return;
            }
          }
        }, true); // Use capture phase to catch events before they're stopped
        
        // Handle Enter key on input
        // Handle Enter key (submit) vs Shift+Enter (new line)
        button.addEventListener('keydown', (e) => {
          const target = e.target;
          const input = target.closest('#hichroney-pill-input');
          
          if ((input || target.id === 'hichroney-pill-input') && e.key === 'Enter') {
            if (e.shiftKey) {
              // Shift+Enter: Allow new line (default textarea behavior)
              return;
            } else {
              // Enter alone: Submit message
              console.log('[Hi Chroney] Enter key pressed in input');
              e.preventDefault();
              e.stopPropagation();
              handlePillSendMessage();
            }
          }
        }, true); // Use capture phase
        
        // Auto-resize textarea on input
        button.addEventListener('input', (e) => {
          const target = e.target;
          if (target.id === 'hichroney-pill-input') {
            autosizeTextarea(target);
          }
        }, true);
        
        // Mobile: Hide nudge and expand button on touch/focus for better UX
        button.addEventListener('touchstart', (e) => {
          const input = e.target.closest('#hichroney-pill-input');
          const inputContainer = e.target.closest('.pill-input-container');
          if (input || e.target.id === 'hichroney-pill-input' || inputContainer) {
            // Hide proactive nudge immediately on touch to prevent blocking
            const nudge = document.getElementById('hichroney-proactive-nudge');
            if (nudge && nudge.parentNode) {
              nudge.parentNode.removeChild(nudge);
            }
          }
        }, { passive: true, capture: true });
        
        // Mobile: Expand button on input focus for better UX
        button.addEventListener('focus', (e) => {
          const input = e.target.closest('#hichroney-pill-input');
          if (input || e.target.id === 'hichroney-pill-input') {
            const isMobile = window.innerWidth <= 480;
            if (isMobile) {
              button.classList.add('pill-expanded');
              // Hide proactive nudge immediately when input is focused on mobile
              const nudge = document.getElementById('hichroney-proactive-nudge');
              if (nudge && nudge.parentNode) {
                nudge.parentNode.removeChild(nudge);
              }
            }
          }
        }, true);
        
        // Mobile: Collapse button on input blur
        button.addEventListener('blur', (e) => {
          const input = e.target.closest('#hichroney-pill-input');
          if (input || e.target.id === 'hichroney-pill-input') {
            const isMobile = window.innerWidth <= 480;
            if (isMobile) {
              // Add delay to prevent blur from interfering with send button click
              setTimeout(() => {
                // Only collapse if send button wasn't clicked
                const sendBtn = document.getElementById('hichroney-pill-send-btn');
                if (sendBtn && !sendBtn.matches(':active')) {
                  button.classList.remove('pill-expanded');
                }
              }, 150); // Small delay to allow click event to fire first
            }
          }
        }, true);
      }


      // Button hover effect - DISABLED on mobile to prevent touch target misalignment
      // CSS transforms cause mobile browsers to misalign touch coordinates
      button.addEventListener('mouseenter', () => {
        // Only apply transform on devices with hover capability (not touch)
        if (window.matchMedia('(hover: hover)').matches) {
          button.style.transform = 'scale(1.05)';
        }
        button.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
      });
      button.addEventListener('mouseleave', () => {
        // Reset transform only if we applied it
        if (window.matchMedia('(hover: hover)').matches) {
          button.style.transform = 'scale(1)';
        }
        button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      });

      // Helper function to lock/unlock body scroll on mobile (prevents parent page from scrolling when chat is open)
      // Preserves scroll position so page doesn't jump to top
      let savedScrollY = 0;
      const lockBodyScroll = (lock) => {
        if (window.innerWidth <= 480) {
          if (lock) {
            // Save current scroll position before locking
            savedScrollY = window.scrollY;
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
            document.body.style.top = `-${savedScrollY}px`;
            document.body.style.left = '0';
          } else {
            // Restore scroll position after unlocking
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.width = '';
            document.body.style.top = '';
            document.body.style.left = '';
            // Restore scroll position
            window.scrollTo(0, savedScrollY);
          }
        }
      };

      // Toggle widget - Handle auto-open setting and remember user preference
      const closedSessionKey = `hichroney-chat-closed-${this.config.businessAccountId}`;
      const openedOnceKey = `hichroney-chat-opened-once-${this.config.businessAccountId}`;
      
      // Check if user closed the chat in this session
      const wasClosed = sessionStorage.getItem(closedSessionKey) === 'true';
      
      // Check if chat was already auto-opened before (for 'once' frequency)
      const wasAlreadyOpened = localStorage.getItem(openedOnceKey) === 'true';
      
      // Detect mobile BEFORE determining initial state
      const isMobile = window.innerWidth <= 480;
      
      // Determine initial state based on granular auto-open setting:
      // Values: 'off', 'desktop', 'mobile', 'both' (legacy 'true' = 'both', 'false' = 'off')
      const autoOpenSetting = this.config.autoOpenChat || 'off';
      const autoOpenFrequency = this.config.autoOpenFrequency || 'once';
      let shouldAutoOpen = false;
      
      // Handle legacy values: 'true' -> 'both', 'false' -> 'off'
      if (autoOpenSetting === 'true' || autoOpenSetting === 'both') {
        shouldAutoOpen = true; // Auto-open on all devices
      } else if (autoOpenSetting === 'desktop') {
        shouldAutoOpen = !isMobile; // Only auto-open on desktop
      } else if (autoOpenSetting === 'mobile') {
        shouldAutoOpen = isMobile; // Only auto-open on mobile
      }
      // 'off' or 'false' -> shouldAutoOpen remains false
      
      // Apply frequency logic:
      // - 'once': Only auto-open if never opened before (stored in localStorage)
      // - 'always': Auto-open every page load
      // - In both cases: If user closed it this session, keep it closed (unless proactive guidance)
      if (shouldAutoOpen && autoOpenFrequency === 'once' && wasAlreadyOpened) {
        shouldAutoOpen = false;
        console.log('[Hi Chroney] Skipping auto-open - already opened once for this visitor');
      }
      
      // For proactive guidance pages, always auto-open regardless of user close preference
      const isProactiveGuidance = this.config.proactiveGuidanceActive === true;
      let isOpen = isProactiveGuidance ? shouldAutoOpen : (wasClosed ? false : shouldAutoOpen);
      
      if (isProactiveGuidance && shouldAutoOpen) {
        console.log('[Hi Chroney] Proactive guidance active - forcing auto-open');
      }
      
      // Mark as opened once if we're auto-opening
      if (isOpen && shouldAutoOpen && autoOpenFrequency === 'once') {
        localStorage.setItem(openedOnceKey, 'true');
      }
      
      console.log('[Hi Chroney] Auto-open setting:', autoOpenSetting, 'frequency:', autoOpenFrequency, 'isMobile:', isMobile, 'shouldAutoOpen:', shouldAutoOpen, 'isOpen:', isOpen);
      
      // No partial mode - always open in full mode
      let isPartialMode = false;
      
      // Set initial state based on configuration
      iframe.style.display = isOpen ? 'block' : 'none';
      
      // When auto-opening, hide the trigger button since chat is already visible
      if (isOpen) {
        // Only hide button completely for pill style - non-pill keeps icon visible
        if (buttonStyle === 'pill') {
          hideButtonCompletely(button);
        }
        // Show dark overlay when auto-opened (but not for proactive guidance pages)
        if (!isProactiveGuidance) {
          showOverlay();
        }
        if (isMobile) {
          iframe.classList.add('mobile-open');
          lockBodyScroll(true);
          console.log('[Hi Chroney] Auto-opened on mobile - fullscreen mode');
        } else {
          console.log('[Hi Chroney] Auto-opened on desktop - full mode (button hidden)');
        }
      }
      
      // Function to expand widget from partial to full mode
      const expandWidget = () => {
        if (isPartialMode) {
          iframe.classList.remove('partial-mode', 'mobile-partial-open');
          isPartialMode = false;
          
          // On mobile, expand to fullscreen (keep button hidden)
          const isMobile = window.innerWidth <= 480;
          if (isMobile) {
            iframe.classList.add('mobile-open');
            container.classList.remove('mobile-partial-hidden');
            // Ensure button stays hidden (it was already hidden by hideButtonCompletely)
            // No need to call hideButtonCompletely again since forceHidden is already set
            lockBodyScroll(true);
            console.log('[Hi Chroney] Expanded to fullscreen on mobile');
          } else {
            console.log('[Hi Chroney] Expanded chat to full height');
          }
        }
      };
      
      // Function to fully open widget (for conversation starters)
      const openWidget = () => {
        if (isOpen) return; // Already open
        
        console.log('[Hi Chroney] Opening widget fully...');
        isOpen = true;
        iframe.style.display = 'block';
        iframe.classList.remove('partial-mode');
        
        // Add futuristic opening animation
        iframe.classList.add('chat-opening');
        setTimeout(() => {
          iframe.classList.remove('chat-opening');
          iframe.classList.add('chat-open-glow');
          setTimeout(() => {
            iframe.classList.remove('chat-open-glow');
          }, 2000);
        }, 500);
        
        // Show dark overlay behind chat (but not for proactive guidance pages)
        if (!isProactiveGuidance) {
          showOverlay();
        }
        
        // Play AI activation sound if enabled
        if (this.config.openingSoundEnabled !== 'false') {
          playOpeningSound(this.config.openingSoundStyle || 'chime');
        }
        
        // Track chat opened event (fire-and-forget)
        if (HiChroneyWidget.visitorToken) {
          fetch(`${HiChroneyWidget.getBaseUrl()}/api/widget/chat-opened`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessAccountId: HiChroneyWidget.config.businessAccountId,
              visitorToken: HiChroneyWidget.visitorToken
            })
          }).catch(() => {});
        }
        isPartialMode = false;
        
        // Only hide button completely for pill style - non-pill keeps icon visible
        if (buttonStyle === 'pill') {
          hideButtonCompletely(button);
          console.log('[Hi Chroney] Chat opened - pill hidden');
        }
        
        const isMobile = window.innerWidth <= 480;
        if (isMobile) {
          iframe.classList.add('mobile-open');
          lockBodyScroll(true);
          console.log('[Hi Chroney] Opened on mobile - fullscreen mode');
        } else {
          console.log('[Hi Chroney] Opened on desktop');
        }
        
        // Remove session storage flag (user didn't close it)
        sessionStorage.removeItem(storageKey);
        
        // Hide starters
        if (widgetStartersContainer) {
          widgetStartersContainer.style.display = 'none';
        }
        
        // Hide button when chat is open (for non-pill styles)
        if (buttonStyle !== 'pill') {
          button.style.display = 'none';
        }
      };

      // Make the existing open lifecycle available to host-page buttons and
      // links without exposing the iframe implementation details.
      this._openWidget = openWidget;
      if (this._pendingOpen) {
        this._pendingOpen = false;
        setTimeout(openWidget, 0);
      }
      
      // Set initial button icon based on state
      if (buttonStyle === 'pill') {
        // Pill button starts as input field, unless chat is already open
        if (isOpen) {
          button.classList.remove('pill--input');
          button.classList.add('pill--close');
        }
        // Input state is already set above for closed state
      } else {
        // For non-pill styles, hide button when chat is open
        if (isOpen) {
          button.style.display = 'none';
        } else {
          button.innerHTML = getAvatarOrIcon(avatarSize, true);
        }
      }
      
      // Store starters container reference for later use
      let widgetStartersContainer = null;
      
      button.addEventListener('click', () => {
        // For pill style with input, clicks should only close (not toggle)
        // Opening happens when user sends a message
        if (buttonStyle === 'pill') {
          // Only handle close action for pill style
          if (isOpen) {
            // For proactive guidance pages, don't allow closing via button
            if (HiChroneyWidget.config.proactiveGuidanceActive === true) {
              console.log('[Hi Chroney] Proactive guidance active - ignoring button close');
              return;
            }
            isOpen = false;
            iframe.style.display = 'none';
            
            // Hide dark overlay
            hideOverlay();
            
            const isMobile = window.innerWidth <= 480;
            
            // Remember user closed the chat
            sessionStorage.setItem(closedSessionKey, 'true');
            
            // Update starters visibility
            if (widgetStartersContainer) {
              widgetStartersContainer.style.display = 'flex';
            }
            
            // Switch back to input field using CSS classes (no innerHTML)
            button.classList.remove('pill--close', 'pill-expanded');
            button.classList.add('pill--input');
            
            // Show button again and force visibility (both mobile and desktop)
            showButtonCompletely(button);
            forceWidgetVisibility(container, button);
            console.log('[Hi Chroney] Chat closed - pill shown');
            
            if (isMobile) {
              iframe.classList.remove('mobile-open', 'mobile-partial-open', 'partial-mode');
              container.classList.remove('mobile-partial-hidden');
              lockBodyScroll(false); // Unlock parent page scroll
            }
          } else {
            // Pill is closed - check if form journey is active
            const pillInput = document.getElementById('hichroney-pill-input');
            if (pillInput && pillInput.dataset.formJourneyActive === 'true') {
              // Form journey active - open chat on any click
              console.log('[Hi Chroney Pill] Form journey active - opening chat on click');
              handlePillSendMessage(); // This opens the chat (and won't send message since input is empty)
            }
            // Otherwise do nothing - user should type and send to open
          }
          return;
        }
        
        // For non-pill styles, keep original toggle behavior
        // But for proactive guidance, prevent closing (only allow opening)
        if (isOpen && HiChroneyWidget.config.proactiveGuidanceActive === true) {
          console.log('[Hi Chroney] Proactive guidance active - ignoring button close');
          return;
        }
        isOpen = !isOpen;
        iframe.style.display = isOpen ? 'block' : 'none';
        
        // Show/hide dark overlay and add animation
        if (isOpen) {
          showOverlay();
          // Add futuristic opening animation
          iframe.classList.add('chat-opening');
          setTimeout(() => {
            iframe.classList.remove('chat-opening');
            iframe.classList.add('chat-open-glow');
            setTimeout(() => {
              iframe.classList.remove('chat-open-glow');
            }, 2000);
          }, 500);
        } else {
          hideOverlay();
        }
        
        // When manually opening, always use full height (not partial mode)
        if (isOpen) {
          iframe.classList.remove('partial-mode');
          isPartialMode = false;
        }
        
        // Add mobile classes and lock/unlock body scroll
        const isMobile = window.innerWidth <= 480;
        if (isMobile) {
          if (isOpen) {
            iframe.classList.add('mobile-open');
            lockBodyScroll(true); // Lock parent page scroll
            
            // CRITICAL: Ensure iframe is a direct child of body to avoid transform inheritance
            // Host page transforms cause touch target misalignment on mobile
            if (iframe.parentElement !== document.body) {
              console.log('[Hi Chroney] Moving iframe to body for proper mobile touch handling');
              document.body.appendChild(iframe);
            }
            // Also ensure container is direct child of body
            ensureDirectBodyChild(container);
          } else {
            iframe.classList.remove('mobile-open', 'mobile-partial-open', 'partial-mode');
            container.classList.remove('mobile-partial-hidden');
            lockBodyScroll(false); // Unlock parent page scroll
          }
        }
        
        // Remember user preference in session storage
        if (isOpen) {
          // User opened the chat - remove the flag so it stays open on refresh
          sessionStorage.removeItem(closedSessionKey);
        } else {
          // User closed the chat - remember this for the session
          sessionStorage.setItem(closedSessionKey, 'true');
        }
        
        // Update starters visibility
        if (widgetStartersContainer) {
          widgetStartersContainer.style.display = isOpen ? 'none' : 'flex';
        }
        
        // Hide button when chat is open
        if (buttonStyle !== 'pill') {
          if (isOpen) {
            button.style.display = 'none';
          } else {
            button.style.display = 'flex';
            button.innerHTML = getAvatarOrIcon(avatarSize, true);
          }
        } else {
          // For pill-style buttons, use the helper functions to properly manage all state
          if (isOpen) {
            hideButtonCompletely(button);
          } else {
            showButtonCompletely(button);
            button.classList.add('pill--input');
          }
        }
      });

      // Listen for close requests from iframe (for mobile close button)
      window.addEventListener('message', (event) => {
        // Verify the message is from our iframe
        const iframeUrl = new URL(iframe.src);
        
        // Check if origin matches or if message is from same origin as iframe
        const isSameOrigin = event.origin === iframeUrl.origin || 
                            event.origin === window.location.origin ||
                            event.source === iframe.contentWindow;
        
        if (!isSameOrigin) {
          console.log('[Hi Chroney Widget] Ignoring message from different origin:', event.origin);
          return;
        }
        
        if (event.data && event.data.type === 'OPEN_URL' && event.data.url) {
          window.open(event.data.url, '_blank', 'noopener,noreferrer');
          return;
        }

        if (event.data === 'CLOSE_WIDGET') {
          console.log('[Hi Chroney Widget] Closing widget via X button');
          // Direct close (bypasses proactive guidance block on button)
          if (isOpen) {
            isOpen = false;
            iframe.style.display = 'none';
            hideOverlay();
            
            const isMobileClose = window.innerWidth <= 480;
            
            // Remember user closed the chat
            sessionStorage.setItem(closedSessionKey, 'true');
            
            // Update starters visibility
            if (widgetStartersContainer) {
              widgetStartersContainer.style.display = 'flex';
            }
            
            // Restore button based on style
            if (buttonStyle === 'pill') {
              button.classList.remove('pill--close', 'pill-expanded');
              button.classList.add('pill--input');
              showButtonCompletely(button);
              forceWidgetVisibility(container, button);
            } else {
              button.style.display = 'flex';
              button.innerHTML = getAvatarOrIcon(avatarSize, true);
            }
            
            if (isMobileClose) {
              iframe.classList.remove('mobile-open', 'mobile-partial-open', 'partial-mode');
              container.classList.remove('mobile-partial-hidden');
              lockBodyScroll(false);
            }
            
            console.log('[Hi Chroney] Chat closed via header X button');
          }
        }
        
        // Handle expand widget message (when user focuses on input in partial mode)
        if (event.data && event.data.type === 'EXPAND_WIDGET') {
          expandWidget();
        }

        // Urgency offer: render on parent page (outside iframe)
        if (event.data && event.data.type === 'URGENCY_OFFER_SHOW') {
          renderUrgencyOffer(event.data.offer, iframe);
        }
        if (event.data && event.data.type === 'URGENCY_OFFER_HIDE') {
          removeUrgencyOffer();
        }
        if (event.data && event.data.type === 'URGENCY_OFFER_REDEEMED') {
          showUrgencyOfferSuccess();
        }
        if (event.data && event.data.type === 'URGENCY_OFFER_REDEEM_ERROR') {
          showUrgencyOfferError(event.data.message);
        }
      });
      
      // URL change detection for proactive guidance (SPA navigation)
      if (isProactiveGuidance) {
        let lastUrl = window.location.pathname + window.location.search;
        const businessAccountId = this.config.businessAccountId; // Capture for closure
        
        // Function to check for URL changes and update guidance
        const checkUrlAndUpdateGuidance = () => {
          const currentUrl = window.location.pathname + window.location.search;
          if (currentUrl === lastUrl) return;
          
          console.log('[Hi Chroney] URL changed:', lastUrl, '->', currentUrl);
          lastUrl = currentUrl;
          
          // Fetch proactive guidance rules and find matching rule
          fetch(`${HiChroneyWidget.getBaseUrl()}/api/public/proactive-guidance-rules/${encodeURIComponent(businessAccountId)}`)
            .then(r => r.json())
            .then(rules => {
              console.log('[Hi Chroney] Fetched', rules?.length || 0, 'guidance rules for URL:', currentUrl);
              if (!rules || rules.length === 0) return;
              
              // Find matching rule (same logic as EmbedChat)
              let matchingRule = null;
              for (const rule of rules) {
                const pattern = rule.urlPattern;
                console.log('[Hi Chroney] Checking pattern:', pattern, 'against URL:', currentUrl, 'exact:', pattern === currentUrl);
                
                // Exact match
                if (pattern === currentUrl) {
                  matchingRule = rule;
                  break;
                }
                
                // Wildcard match
                if (pattern.includes('*')) {
                  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
                  const regexPattern = escaped.replace(/\*/g, '.*');
                  try {
                    const regex = new RegExp('^' + regexPattern + '$');
                    if (regex.test(currentUrl)) {
                      matchingRule = rule;
                      break;
                    }
                  } catch (e) {}
                }
                
                // Prefix match
                if (currentUrl.indexOf(pattern) === 0) {
                  matchingRule = rule;
                  break;
                }
              }
              
              if (matchingRule && matchingRule.message) {
                console.log('[Hi Chroney] Found guidance for new URL:', matchingRule.name);
                
                // CRITICAL: Set proactiveGuidanceActive flag when rule matches
                // This enables assistant mode: no overlay, prevents closing
                HiChroneyWidget.config.proactiveGuidanceActive = true;
                console.log('[Hi Chroney] ✅ Proactive guidance mode ACTIVATED for URL change');
                
                // Hide any existing overlay for assistant mode (no blocking overlay)
                hideOverlay();
                
                // Ensure chat is open and visible for proactive guidance
                if (!isOpen) {
                  isOpen = true;
                  iframe.style.display = 'block';
                }
                
                // Build guidance message payload
                const guidancePayload = {
                  type: 'PROACTIVE_GUIDANCE',
                  message: matchingRule.message,
                  clearHistory: true, // Start fresh for each new screen
                  cleanMode: matchingRule.cleanMode === true
                };
                
                // Only include conversation starters if the rule actually defines them
                if (matchingRule.conversationStarters) {
                  try {
                    const ruleStarters = typeof matchingRule.conversationStarters === 'string' 
                      ? JSON.parse(matchingRule.conversationStarters) 
                      : matchingRule.conversationStarters;
                    if (Array.isArray(ruleStarters)) {
                      guidancePayload.conversationStarters = ruleStarters;
                      console.log('[Hi Chroney] Including rule starters:', ruleStarters.length);
                    }
                  } catch (e) {
                    console.warn('[Hi Chroney] Failed to parse rule conversationStarters:', e);
                  }
                }
                
                // Send new guidance message to iframe
                iframe.contentWindow.postMessage(guidancePayload, '*');
                console.log('[Hi Chroney] Sent PROACTIVE_GUIDANCE message');
              } else {
                // If no rule matches on new URL, deactivate proactive guidance mode
                if (HiChroneyWidget.config.proactiveGuidanceActive) {
                  HiChroneyWidget.config.proactiveGuidanceActive = false;
                  console.log('[Hi Chroney] Proactive guidance mode deactivated - no matching rule');
                }
                console.log('[Hi Chroney] No matching guidance rule found for URL:', currentUrl);
              }
            })
            .catch(err => console.log('[Hi Chroney] Failed to fetch guidance rules:', err));
        };
        
        // Listen for popstate (back/forward buttons)
        window.addEventListener('popstate', checkUrlAndUpdateGuidance);
        
        // Intercept pushState and replaceState
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        
        history.pushState = function(...args) {
          originalPushState.apply(this, args);
          setTimeout(checkUrlAndUpdateGuidance, 50);
        };
        
        history.replaceState = function(...args) {
          originalReplaceState.apply(this, args);
          setTimeout(checkUrlAndUpdateGuidance, 50);
        };
        
        console.log('[Hi Chroney] URL change detection enabled for proactive guidance');
      }
      
      // Create Conversation Starters Container (colored chips above pill)
      // Only show if both showConversationStarters AND showStartersOnPill are enabled
      if (this.config.showConversationStarters && 
          this.config.showStartersOnPill &&
          Array.isArray(this.config.conversationStarters) && 
          this.config.conversationStarters.length > 0) {
        widgetStartersContainer = document.createElement('div');
        widgetStartersContainer.id = 'hichroney-starters-container';
        
        // Calculate position based on widget position
        const startersGap = 10; // Gap between button and starters
        const startersBottomOffset = bubbleSize + startersGap + (parseInt(this.config.pillBottomOffset, 10) || 20); // button bottom offset + button size + gap
        const startersRightOffset = parseInt(this.config.pillSideOffset, 10) || 20; // Same as button horizontal offset
        
        // Position starters above button based on widget position
        let startersPosition = '';
        if (verticalPos === 'bottom') {
          startersPosition = `bottom: ${startersBottomOffset}px;`;
        } else {
          startersPosition = `top: ${startersBottomOffset}px;`;
        }
        
        startersPosition += horizontalPos === 'right' ? ` right: ${startersRightOffset}px;` : ` left: ${startersRightOffset}px;`;
        
        widgetStartersContainer.style.cssText = `
          position: fixed;
          ${startersPosition}
          display: flex;
          flex-direction: column;
          gap: 6px;
          z-index: 999997;
          max-width: 280px;
          transition: opacity 0.3s, transform 0.3s;
        `;
        
        // Add each starter as a button
        this.config.conversationStarters.forEach((starter) => {
          const starterBtn = document.createElement('button');
          starterBtn.textContent = starter;
          starterBtn.style.cssText = `
            padding: 8px 14px;
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: linear-gradient(135deg, ${this.config.chatColor}, ${this.config.chatColorEnd});
            color: white;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.4;
            cursor: pointer;
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08);
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            text-align: left;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            position: relative;
            overflow: hidden;
          `;
          
          // Hover effects
          starterBtn.addEventListener('mouseenter', () => {
            starterBtn.style.transform = 'translateY(-1px) scale(1.01)';
            starterBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.12)';
          });
          
          starterBtn.addEventListener('mouseleave', () => {
            starterBtn.style.transform = 'translateY(0) scale(1)';
            starterBtn.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)';
          });
          
          // Click handler - open chat and send message
          starterBtn.addEventListener('click', () => {
            console.log('[Conversation Starter] Clicked:', starter);
            console.log('[Conversation Starter] Chat is open:', isOpen, 'Partial mode:', isPartialMode);
            
            // Open the widget if closed
            if (!isOpen) {
              console.log('[Conversation Starter] Opening chat fully...');
              openWidget();
            } else if (isPartialMode) {
              // If already open but in partial mode, expand to full
              console.log('[Conversation Starter] Expanding from partial mode...');
              expandWidget();
            }
            
            console.log('[Conversation Starter] Sending message:', starter);
            
            // Send message to iframe using reliable queuing system
            sendMessageToIframe({
              type: 'SEND_MESSAGE',
              message: starter,
              visitorSessionId: window.VisitorSession?.sessionId || null
            });
          });
          
          widgetStartersContainer.appendChild(starterBtn);
        });
        
        // Set initial visibility based on chat state
        widgetStartersContainer.style.display = isOpen ? 'none' : 'flex';
      }
      
      // Create Proactive Nudge Popup with Sequential Messages Support
      let proactiveNudgePopup = null;
      let proactiveNudgeTimers = [];
      let proactiveNudgeShown = false;
      let currentMessageIndex = 0;
      let closedMessageIndices = new Set(); // Track which messages have been closed by user
      let nudgeSequenceStopped = false; // Stop entire sequence when user engages with chat
      const proactiveNudgeSessionKey = `hichroney-nudge-shown-${this.config.businessAccountId}`;
      const shouldRepeatNudge = this.config.proactiveNudgeRepeat === 'true';
      
      // Build full message sequence: first message + additional messages
      const allNudgeMessages = [
        { message: this.config.proactiveNudgeMessage || "Need help finding something? I'm here to assist!", delay: parseInt(this.config.proactiveNudgeDelay) || 15 }
      ];
      if (this.config.proactiveNudgeMessages && Array.isArray(this.config.proactiveNudgeMessages)) {
        allNudgeMessages.push(...this.config.proactiveNudgeMessages);
      }
      
      console.log('[Hi Chroney] Proactive nudge sequence:', allNudgeMessages.length, 'messages');
      
      // Check if nudge was already shown this session (skip if repeat is enabled)
      if (!shouldRepeatNudge && sessionStorage.getItem(proactiveNudgeSessionKey) === 'true') {
        proactiveNudgeShown = true;
      }
      
      // Function to clear all nudge timers
      const clearAllNudgeTimers = () => {
        proactiveNudgeTimers.forEach(timer => clearTimeout(timer));
        proactiveNudgeTimers = [];
      };
      
      // Convert **bold** markdown to <strong> for popup display
      const parseBoldMarkdown = (text) => {
        return String(text).replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700">$1</strong>');
      };

      // Function to update nudge message text (for sequential messages)
      const updateNudgeMessage = (messageText) => {
        if (proactiveNudgePopup) {
          const messageSpan = proactiveNudgePopup.querySelector('span');
          if (messageSpan) {
            // Fade out, update, fade in
            proactiveNudgePopup.style.opacity = '0';
            setTimeout(() => {
              messageSpan.innerHTML = parseBoldMarkdown(messageText);
              proactiveNudgePopup.style.opacity = '1';
            }, 200);
          }
        }
      };
      
      // Function to show a nudge popup
      const showNudgePopup = (messageText, chatColor, chatColorEnd) => {
        // Remove existing popup if any
        if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
          proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
        }
        
        // Create nudge popup
        proactiveNudgePopup = document.createElement('div');
        proactiveNudgePopup.id = 'hichroney-proactive-nudge';
        
        // Calculate position based on widget position
        const isMobileNudge = window.innerWidth <= 480;
        const buttonHeight = (isMobileNudge && buttonStyle === 'pill') ? 64 : bubbleSize;
        const nudgeGap = 10;
        const buttonBottomOffset = parseInt(this.config.pillBottomOffset, 10) || 20;
        const nudgeBottomOffset = buttonBottomOffset + buttonHeight + nudgeGap;
        const nudgeHorizontalOffset = parseInt(this.config.pillSideOffset, 10) || 20;
        
        let nudgePosition = '';
        if (verticalPos === 'bottom') {
          nudgePosition = `bottom: ${nudgeBottomOffset}px;`;
        } else {
          nudgePosition = `top: ${nudgeBottomOffset}px;`;
        }
        nudgePosition += horizontalPos === 'right' ? ` right: ${nudgeHorizontalOffset}px;` : ` left: ${nudgeHorizontalOffset}px;`;
        
        const nudgeBgColor = this.config.proactiveNudgeBgColor || '#ffffff';
        const nudgeBgColorEnd = this.config.proactiveNudgeBgColorEnd || '#ffffff';
        const nudgeTextColor = this.config.proactiveNudgeTextColor || '#1f2937';
        const nudgeBg = nudgeBgColor === nudgeBgColorEnd ? nudgeBgColor : `linear-gradient(135deg, ${nudgeBgColor}, ${nudgeBgColorEnd})`;
        proactiveNudgePopup.style.cssText = `
          position: fixed;
          ${nudgePosition}
          max-width: 260px;
          padding: 12px 16px;
          padding-right: 32px;
          background: ${nudgeBg};
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.1);
          z-index: 999998;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: ${nudgeTextColor};
          cursor: pointer;
          transform: translateY(20px);
          opacity: 0;
          transition: transform 0.3s ease-out, opacity 0.3s ease-out;
          border-left: 4px solid ${chatColor};
          overflow: hidden;
          box-sizing: border-box;
        `;
        
        proactiveNudgePopup.innerHTML = `
          <button id="hichroney-nudge-close" style="
            position: absolute;
            top: 8px;
            right: 8px;
            width: 20px;
            height: 20px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: #9ca3af;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s, color 0.2s;
          ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="
              width: 8px;
              height: 8px;
              border-radius: 50%;
              background: linear-gradient(135deg, ${chatColor}, ${chatColorEnd});
              flex-shrink: 0;
              margin-top: 6px;
              animation: hichroney-pulse 2s infinite;
            "></div>
            <span>${parseBoldMarkdown(messageText)}</span>
          </div>
        `;
        
        // Add pulse animation
        const styleEl = document.createElement('style');
        styleEl.textContent = `
          @keyframes hichroney-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.2); }
          }
        `;
        proactiveNudgePopup.appendChild(styleEl);
        
        document.body.appendChild(proactiveNudgePopup);
        
        // Animate in
        setTimeout(() => {
          proactiveNudgePopup.style.transform = 'translateY(0)';
          proactiveNudgePopup.style.opacity = '1';
        }, 50);
        
        // Close button handler - marks message as closed, allows other messages to show
        const closeBtn = proactiveNudgePopup.querySelector('#hichroney-nudge-close');
        closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = '#f3f4f6';
          closeBtn.style.color = '#374151';
        });
        closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = 'transparent';
          closeBtn.style.color = '#9ca3af';
        });
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Mark the current message as closed (won't show again until page refresh)
          closedMessageIndices.add(currentMessageIndex);
          console.log('[Hi Chroney] Message', currentMessageIndex + 1, 'closed by user, won\'t show again');
          
          // DON'T clear timers - allow next messages in sequence to show
          // Just hide the current popup
          if (proactiveNudgePopup) {
            proactiveNudgePopup.style.transform = 'translateY(20px)';
            proactiveNudgePopup.style.opacity = '0';
            setTimeout(() => {
              if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
                proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
                proactiveNudgePopup = null; // Set to null so next message recreates it
              }
            }, 300);
          }
        });
        
        // Click on popup opens chat - stops entire sequence
        proactiveNudgePopup.addEventListener('click', () => {
          nudgeSequenceStopped = true; // Permanently stop sequence
          clearAllNudgeTimers();
          if (!isOpen) {
            button.click();
          }
          if (proactiveNudgePopup) {
            const isMobile = window.innerWidth <= 480;
            if (isMobile) {
              if (proactiveNudgePopup.parentNode) {
                proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
              }
            } else {
              proactiveNudgePopup.style.transform = 'translateY(20px)';
              proactiveNudgePopup.style.opacity = '0';
              setTimeout(() => {
                if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
                  proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
                }
              }, 300);
            }
          }
        });
      };
      
      // Start sequential nudge messages with repeat support
      if (this.config.proactiveNudgeEnabled === 'true' && !proactiveNudgeShown && !isOpen) {
        const chatColor = this.config.chatColor;
        const chatColorEnd = this.config.chatColorEnd;
        
        // Function to schedule the nudge sequence (can be called again for repeating)
        const scheduleNudgeSequence = (startFromIndex = 0, initialDelay = 0) => {
          if (nudgeSequenceStopped || isOpen) return;
          
          // Check if all messages have been closed
          const remainingMessages = allNudgeMessages.filter((_, idx) => !closedMessageIndices.has(idx));
          if (remainingMessages.length === 0) {
            console.log('[Hi Chroney] All messages closed by user, stopping sequence');
            return;
          }
          
          let cumulativeDelay = initialDelay;
          let lastScheduledIndex = -1;
          
          allNudgeMessages.forEach((msg, index) => {
            if (index < startFromIndex) return; // Skip already shown messages in this cycle
            
            cumulativeDelay += msg.delay;
            lastScheduledIndex = index;
            
            const timer = setTimeout(() => {
              if (nudgeSequenceStopped || isOpen) return;
              
              // Skip if this message was closed by user
              if (closedMessageIndices.has(index)) {
                console.log('[Hi Chroney] Skipping message', index + 1, '(closed by user)');
                return;
              }
              
              // Update current message index for close tracking
              currentMessageIndex = index;
              
              if (index === 0 && !proactiveNudgeShown) {
                // First message ever - mark as shown and create popup
                proactiveNudgeShown = true;
                sessionStorage.setItem(proactiveNudgeSessionKey, 'true');
                showNudgePopup(msg.message, chatColor, chatColorEnd);
                console.log('[Hi Chroney] Proactive nudge message 1 shown');
              } else {
                // Subsequent messages or repeat cycles
                if (!proactiveNudgePopup) {
                  showNudgePopup(msg.message, chatColor, chatColorEnd);
                  console.log('[Hi Chroney] Proactive nudge message', index + 1, 'shown (created)');
                } else {
                  updateNudgeMessage(msg.message);
                  console.log('[Hi Chroney] Proactive nudge message', index + 1, 'shown (updated)');
                }
              }
              
              // If this is the last message, schedule the sequence to repeat
              if (index === allNudgeMessages.length - 1) {
                // Get delay of first non-closed message for restart
                const firstAvailableMsg = allNudgeMessages.find((_, idx) => !closedMessageIndices.has(idx));
                if (firstAvailableMsg) {
                  const restartDelay = firstAvailableMsg.delay * 1000;
                  const restartTimer = setTimeout(() => {
                    if (!nudgeSequenceStopped && !isOpen) {
                      console.log('[Hi Chroney] Restarting nudge sequence');
                      scheduleNudgeSequence(0, 0);
                    }
                  }, restartDelay);
                  proactiveNudgeTimers.push(restartTimer);
                }
              }
            }, cumulativeDelay * 1000);
            proactiveNudgeTimers.push(timer);
          });
        };
        
        // Start the initial sequence
        scheduleNudgeSequence(0, 0);
        console.log('[Hi Chroney] Scheduled', allNudgeMessages.length, 'nudge messages with repeat');
      }
      
      // Hide proactive nudge when chat opens - stops entire sequence
      button.addEventListener('click', () => {
        nudgeSequenceStopped = true; // Permanently stop sequence when user engages
        clearAllNudgeTimers();
        if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
          const isMobile = window.innerWidth <= 480;
          // On mobile, remove immediately without animation to prevent touch interception
          if (isMobile) {
            proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
          } else {
            proactiveNudgePopup.style.transform = 'translateY(20px)';
            proactiveNudgePopup.style.opacity = '0';
            setTimeout(() => {
              if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
                proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
              }
            }, 300);
          }
        }
      });
      
      // ============================================================
      // CENTER BANNER POPUP - Personalized Engagement Modal
      // ============================================================
      let centerBannerPopup = null;
      let centerBannerShown = false;
      const centerBannerSessionKey = `hichroney-center-banner-${this.config.businessAccountId}`;
      const centerBannerEnabled = this.config.centerBannerEnabled === 'true';
      const centerBannerShowOnce = this.config.centerBannerShowOnce !== 'false'; // Default true
      const centerBannerDelay = parseInt(this.config.centerBannerDelay) || 10;
      const centerBannerTitle = this.config.centerBannerTitle || "Need Help?";
      const centerBannerDescription = this.config.centerBannerDescription || "Let me help you find exactly what you're looking for.";
      const centerBannerButtonText = this.config.centerBannerButtonText || "Start Chat";
      const centerBannerBackgroundStyle = this.config.centerBannerBackgroundStyle || "gradient";
      const centerBannerStartColor = this.config.centerBannerStartColor || "#9333ea";
      const centerBannerEndColor = this.config.centerBannerEndColor || "#3b82f6";
      const centerBannerTextColor = this.config.centerBannerTextColor || "white";
      const centerBannerImageUrl = this.config.centerBannerImageUrl || null;
      
      // Re-engagement banner settings
      const reengagementBannerEnabled = this.config.reengagementBannerEnabled === 'true' || this.config.reengagementBannerEnabled === true;
      const reengagementBannerDelay = parseInt(this.config.reengagementBannerDelay || "60", 10);
      const reengagementBannerTitle = this.config.reengagementBannerTitle || "Still looking around?";
      const reengagementBannerDescription = this.config.reengagementBannerDescription || "I'm here whenever you're ready to chat!";
      const reengagementBannerButtonText = this.config.reengagementBannerButtonText || "Chat Now";
      let reengagementBannerShown = false;
      let reengagementTimerId = null;
      
      const chatColor = this.config.chatColor || "#9333ea"; // For CTA button text color
      const avatarType = this.config.avatarType || 'none';
      const avatarUrl = this.config.avatarUrl || null;
      const bannerBaseUrl = this.getBaseUrl(); // Use different name to avoid conflict
      
      // Determine text color values
      const textColorMain = centerBannerTextColor === "black" ? "#1a1a1a" : "white";
      const textColorSecondary = centerBannerTextColor === "black" ? "#333333" : "rgba(255, 255, 255, 0.9)";
      const iconBgColor = centerBannerTextColor === "black" ? "rgba(0, 0, 0, 0.1)" : "rgba(255, 255, 255, 0.2)";
      const closeBtnBg = centerBannerTextColor === "black" ? "rgba(0, 0, 0, 0.1)" : "rgba(255, 255, 255, 0.2)";
      const closeBtnHoverBg = centerBannerTextColor === "black" ? "rgba(0, 0, 0, 0.2)" : "rgba(255, 255, 255, 0.3)";
      
      // Check if banner was already shown this session (if showOnce is enabled)
      if (centerBannerShowOnce && sessionStorage.getItem(centerBannerSessionKey) === 'true') {
        centerBannerShown = true;
      }
      
      // Function to show center banner
      const showCenterBanner = () => {
        if (!centerBannerEnabled || centerBannerShown || isOpen) return;
        
        centerBannerShown = true;
        if (centerBannerShowOnce) {
          sessionStorage.setItem(centerBannerSessionKey, 'true');
        }
        
        console.log('[Hi Chroney] Showing center banner');
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'hichroney-center-banner-overlay';
        overlay.style.cssText = `
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          z-index: 2147483646;
          opacity: 0;
          transition: opacity 0.3s ease-out;
          cursor: pointer;
        `;
        
        // Create banner
        centerBannerPopup = document.createElement('div');
        centerBannerPopup.id = 'hichroney-center-banner';
        
        // Determine background style
        let backgroundCSS = '';
        if (centerBannerBackgroundStyle === 'image' && centerBannerImageUrl) {
          backgroundCSS = `background: url('${centerBannerImageUrl}') center/cover no-repeat;`;
        } else {
          backgroundCSS = `background: linear-gradient(135deg, ${centerBannerStartColor}, ${centerBannerEndColor});`;
        }
        
        const isMobileBanner = window.innerWidth <= 480;
        
        centerBannerPopup.style.cssText = `
          position: fixed;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          width: ${isMobileBanner ? 'calc(100% - 32px)' : '400px'};
          max-width: 400px;
          padding: ${isMobileBanner ? '32px 24px' : '40px 32px'};
          ${backgroundCSS}
          border-radius: 24px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.3);
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          text-align: center;
          opacity: 0;
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out;
          box-sizing: border-box;
          overflow: hidden;
        `;
        
        // Add image overlay if using image background
        const overlayDiv = centerBannerBackgroundStyle === 'image' ? `
          <div style="
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            z-index: 0;
          "></div>
        ` : '';
        
        centerBannerPopup.innerHTML = `
          ${overlayDiv}
          <button id="hichroney-banner-close" style="
            position: absolute;
            top: 16px;
            right: 16px;
            width: 32px;
            height: 32px;
            border: none;
            background: ${closeBtnBg};
            cursor: pointer;
            color: ${textColorMain};
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s, transform 0.2s;
            z-index: 10;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <div style="position: relative; z-index: 1;">
            <div style="
              position: relative;
              width: 80px;
              height: 80px;
              margin: 0 auto 20px;
            ">
              <!-- Glow ring animation -->
              <div style="
                position: absolute;
                inset: -8px;
                border-radius: 50%;
                background: ${centerBannerTextColor === 'black' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.3)'};
                animation: hichroney-banner-glow 2s ease-in-out infinite;
              "></div>
              <!-- Outer sparkle ring -->
              <div style="
                position: absolute;
                inset: -4px;
                border-radius: 50%;
                background: ${centerBannerTextColor === 'black' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.2)'};
                animation: hichroney-banner-sparkle 3s ease-in-out infinite;
              "></div>
              <!-- Avatar container -->
              <div style="
                position: relative;
                width: 80px;
                height: 80px;
                border-radius: 50%;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                border: 4px solid ${centerBannerTextColor === 'black' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.4)'};
                animation: hichroney-banner-float 3s ease-in-out infinite;
              ">
                ${avatarType && avatarType !== 'none' ? `
                  <img 
                    src="${avatarType === 'custom' ? (avatarUrl || '') : bannerBaseUrl + '/avatars/avatar-' + avatarType.replace('preset-', '') + '.png'}"
                    alt="AI Assistant"
                    style="width: 100%; height: 100%; object-fit: cover;"
                  />
                ` : `
                  <div style="
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: ${iconBgColor};
                  ">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${textColorMain}" stroke-width="2">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                    </svg>
                  </div>
                `}
              </div>
            </div>
            <h2 style="
              color: ${textColorMain};
              font-size: ${isMobileBanner ? '24px' : '28px'};
              font-weight: 700;
              margin: 0 0 12px;
              line-height: 1.2;
              text-shadow: ${centerBannerTextColor === 'black' ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.1)'};
            ">${centerBannerTitle}</h2>
            <p style="
              color: ${textColorSecondary};
              font-size: ${isMobileBanner ? '15px' : '16px'};
              margin: 0 0 24px;
              line-height: 1.5;
            ">${centerBannerDescription}</p>
            <button id="hichroney-banner-cta" style="
              background: white;
              color: ${chatColor};
              border: none;
              padding: ${isMobileBanner ? '14px 32px' : '16px 40px'};
              font-size: ${isMobileBanner ? '16px' : '17px'};
              font-weight: 600;
              border-radius: 100px;
              cursor: pointer;
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
              transition: transform 0.2s, box-shadow 0.2s;
              width: ${isMobileBanner ? '100%' : 'auto'};
            ">${centerBannerButtonText}</button>
          </div>
        `;
        
        // Add animation styles
        const styleEl = document.createElement('style');
        styleEl.textContent = `
          @keyframes hichroney-banner-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.9; }
          }
          @keyframes hichroney-banner-float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-8px); }
          }
          @keyframes hichroney-banner-glow {
            0%, 100% { opacity: 0.3; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.15); }
          }
          @keyframes hichroney-banner-sparkle {
            0%, 100% { opacity: 0.4; transform: scale(1) rotate(0deg); }
            50% { opacity: 0.8; transform: scale(1.1) rotate(180deg); }
          }
        `;
        centerBannerPopup.appendChild(styleEl);
        
        document.body.appendChild(overlay);
        document.body.appendChild(centerBannerPopup);
        
        // Animate in
        requestAnimationFrame(() => {
          overlay.style.opacity = '1';
          setTimeout(() => {
            centerBannerPopup.style.opacity = '1';
            centerBannerPopup.style.transform = 'translate(-50%, -50%) scale(1)';
          }, 50);
        });
        
        // Close banner function
        const closeBanner = (triggeredByUser = true) => {
          overlay.style.opacity = '0';
          centerBannerPopup.style.opacity = '0';
          centerBannerPopup.style.transform = 'translate(-50%, -50%) scale(0.9)';
          setTimeout(() => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (centerBannerPopup && centerBannerPopup.parentNode) {
              centerBannerPopup.parentNode.removeChild(centerBannerPopup);
              centerBannerPopup = null;
            }
          }, 300);
          
          // Schedule re-engagement banner if enabled and user dismissed (not clicked CTA)
          if (triggeredByUser && reengagementBannerEnabled && !reengagementBannerShown && !isOpen) {
            console.log('[Hi Chroney] Scheduling re-engagement banner in', reengagementBannerDelay, 'seconds');
            reengagementTimerId = setTimeout(() => {
              if (!isOpen && !reengagementBannerShown) {
                showReengagementBanner();
              }
            }, reengagementBannerDelay * 1000);
          }
        };
        
        // Close button handler
        const closeBtn = centerBannerPopup.querySelector('#hichroney-banner-close');
        closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = closeBtnHoverBg;
          closeBtn.style.transform = 'scale(1.1)';
        });
        closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = closeBtnBg;
          closeBtn.style.transform = 'scale(1)';
        });
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[Hi Chroney] Center banner closed by user');
          closeBanner();
        });
        
        // Overlay click closes banner
        overlay.addEventListener('click', () => {
          console.log('[Hi Chroney] Center banner closed via overlay');
          closeBanner();
        });
        
        // CTA button opens chat
        const ctaBtn = centerBannerPopup.querySelector('#hichroney-banner-cta');
        ctaBtn.addEventListener('mouseenter', () => {
          ctaBtn.style.transform = 'scale(1.05)';
          ctaBtn.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.2)';
        });
        ctaBtn.addEventListener('mouseleave', () => {
          ctaBtn.style.transform = 'scale(1)';
          ctaBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
        });
        ctaBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[Hi Chroney] Center banner CTA clicked - opening chat');
          closeBanner(false); // false = don't schedule re-engagement (user clicked CTA)
          // Clear any scheduled re-engagement timer
          if (reengagementTimerId) {
            clearTimeout(reengagementTimerId);
            reengagementTimerId = null;
          }
          // Open chat with proper mobile fullscreen handling
          if (!isOpen) {
            isOpen = true;
            iframe.style.display = 'block';
            iframe.classList.remove('partial-mode', 'mobile-partial-open');
            isPartialMode = false;
            
            // Play AI activation sound if enabled
            if (HiChroneyWidget.config.openingSoundEnabled !== 'false') {
              playOpeningSound(HiChroneyWidget.config.openingSoundStyle || 'chime');
            }
            
            // On mobile, go fullscreen (same as clicking chat bubble)
            const isMobileBannerCta = window.innerWidth <= 480;
            if (isMobileBannerCta) {
              iframe.classList.add('mobile-open');
              lockBodyScroll(true);
              hideButtonCompletely(button);
              console.log('[Hi Chroney] Chat opened from center banner - mobile fullscreen');
            } else {
              // Hide button properly for both pill and non-pill styles
              if (buttonStyle === 'pill') {
                hideButtonCompletely(button);
              } else {
                button.style.display = 'none';
              }
              console.log('[Hi Chroney] Chat opened from center banner - desktop');
            }
            
            if (widgetStartersContainer) {
              widgetStartersContainer.style.display = 'none';
            }
            // Clear any nudge popups
            if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
              proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
            }
          }
        });
      };
      
      // Re-engagement Banner function (shows after first banner is dismissed)
      const showReengagementBanner = () => {
        if (isOpen || reengagementBannerShown) {
          console.log('[Hi Chroney] Re-engagement banner skipped - chat is open or already shown');
          return;
        }
        
        reengagementBannerShown = true;
        console.log('[Hi Chroney] Showing re-engagement banner');
        
        // Create overlay
        const reOverlay = document.createElement('div');
        reOverlay.id = 'hichroney-reengagement-overlay';
        reOverlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 10000000;
          opacity: 0;
          transition: opacity 0.3s ease;
          backdrop-filter: blur(4px);
        `;
        document.body.appendChild(reOverlay);
        
        // Create popup
        let rePopup = document.createElement('div');
        rePopup.id = 'hichroney-reengagement-popup';
        rePopup.innerHTML = `
          <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0.9);
            ${centerBannerBackgroundStyle === 'image' && centerBannerImageUrl 
              ? `background-image: url('${centerBannerImageUrl}'); background-size: cover; background-position: center;`
              : `background: linear-gradient(135deg, ${centerBannerStartColor}, ${centerBannerEndColor});`
            }
            border-radius: 20px;
            padding: 40px 30px 30px;
            min-width: 320px;
            max-width: 400px;
            box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
            z-index: 10000001;
            opacity: 0;
            transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
            text-align: center;
            overflow: hidden;
          ">
            ${centerBannerBackgroundStyle === 'image' ? '<div style="position: absolute; inset: 0; background: rgba(0,0,0,0.4); border-radius: 20px;"></div>' : ''}
            <div style="position: relative; z-index: 1;">
              <button id="hichroney-reengagement-close" style="
                position: absolute;
                top: -25px;
                right: -15px;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: none;
                background: ${closeBtnBg};
                color: ${centerBannerTextColor === 'black' ? '#333' : 'white'};
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
                transition: all 0.2s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
              ">&times;</button>
              
              <div style="
                width: 80px;
                height: 80px;
                margin: 0 auto 20px;
                border-radius: 50%;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                border: 4px solid ${centerBannerTextColor === 'black' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.4)'};
                animation: hichroney-banner-float 3s ease-in-out infinite;
              ">
                ${avatarType && avatarType !== 'none' ? `
                  <img 
                    src="${avatarType === 'custom' ? (avatarUrl || '') : bannerBaseUrl + '/avatars/avatar-' + avatarType.replace('preset-', '') + '.png'}"
                    alt="AI Assistant"
                    style="width: 100%; height: 100%; object-fit: cover;"
                  />
                ` : `
                  <div style="
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: ${centerBannerTextColor === 'black' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'};
                  ">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${centerBannerTextColor === 'black' ? '#1a1a1a' : 'white'}" stroke-width="2">
                      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                  </div>
                `}
              </div>
              
              <h2 style="
                margin: 0 0 10px;
                font-size: 24px;
                font-weight: 700;
                color: ${textColorMain};
                text-shadow: ${centerBannerTextColor === 'black' ? 'none' : '0 2px 4px rgba(0,0,0,0.2)'};
              ">${reengagementBannerTitle}</h2>
              
              <p style="
                margin: 0 0 24px;
                font-size: 15px;
                color: ${textColorSecondary};
                line-height: 1.5;
              ">${reengagementBannerDescription}</p>
              
              <button id="hichroney-reengagement-cta" style="
                background: white;
                color: ${chatColor};
                border: none;
                padding: 14px 32px;
                border-radius: 50px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
                transition: all 0.2s ease;
              ">${reengagementBannerButtonText}</button>
            </div>
          </div>
        `;
        document.body.appendChild(rePopup);
        
        // Animate in
        setTimeout(() => {
          reOverlay.style.opacity = '1';
          const popupInner = rePopup.querySelector('div');
          if (popupInner) {
            popupInner.style.opacity = '1';
            popupInner.style.transform = 'translate(-50%, -50%) scale(1)';
          }
        }, 50);
        
        // Close function
        const closeReengagement = () => {
          reOverlay.style.opacity = '0';
          const popupInner = rePopup.querySelector('div');
          if (popupInner) {
            popupInner.style.opacity = '0';
            popupInner.style.transform = 'translate(-50%, -50%) scale(0.9)';
          }
          setTimeout(() => {
            if (reOverlay.parentNode) reOverlay.parentNode.removeChild(reOverlay);
            if (rePopup && rePopup.parentNode) {
              rePopup.parentNode.removeChild(rePopup);
              rePopup = null;
            }
          }, 300);
        };
        
        // Close button
        const reCloseBtn = rePopup.querySelector('#hichroney-reengagement-close');
        reCloseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[Hi Chroney] Re-engagement banner closed');
          closeReengagement();
        });
        
        // Overlay click
        reOverlay.addEventListener('click', () => {
          console.log('[Hi Chroney] Re-engagement banner closed via overlay');
          closeReengagement();
        });
        
        // CTA button
        const reCtaBtn = rePopup.querySelector('#hichroney-reengagement-cta');
        reCtaBtn.addEventListener('mouseenter', () => {
          reCtaBtn.style.transform = 'scale(1.05)';
          reCtaBtn.style.boxShadow = '0 6px 24px rgba(0, 0, 0, 0.2)';
        });
        reCtaBtn.addEventListener('mouseleave', () => {
          reCtaBtn.style.transform = 'scale(1)';
          reCtaBtn.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
        });
        reCtaBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[Hi Chroney] Re-engagement CTA clicked - opening chat');
          closeReengagement();
          if (!isOpen) {
            isOpen = true;
            iframe.style.display = 'block';
            iframe.classList.remove('partial-mode', 'mobile-partial-open');
            isPartialMode = false;
            
            // Play AI activation sound if enabled
            if (HiChroneyWidget.config.openingSoundEnabled !== 'false') {
              playOpeningSound(HiChroneyWidget.config.openingSoundStyle || 'chime');
            }
            
            // On mobile, go fullscreen (same as clicking chat bubble)
            const isMobileReengagement = window.innerWidth <= 480;
            if (isMobileReengagement) {
              iframe.classList.add('mobile-open');
              lockBodyScroll(true);
              hideButtonCompletely(button);
              console.log('[Hi Chroney] Chat opened from re-engagement banner - mobile fullscreen');
            } else {
              // Hide button properly for both pill and non-pill styles
              if (buttonStyle === 'pill') {
                hideButtonCompletely(button);
              } else {
                button.style.display = 'none';
              }
              console.log('[Hi Chroney] Chat opened from re-engagement banner - desktop');
            }
            
            if (widgetStartersContainer) {
              widgetStartersContainer.style.display = 'none';
            }
            if (proactiveNudgePopup && proactiveNudgePopup.parentNode) {
              proactiveNudgePopup.parentNode.removeChild(proactiveNudgePopup);
            }
          }
        });
      };
      
      // Schedule center banner display
      console.log('[Hi Chroney] Center banner check:', {
        enabled: centerBannerEnabled,
        configValue: this.config.centerBannerEnabled,
        alreadyShown: centerBannerShown,
        chatIsOpen: isOpen,
        delay: centerBannerDelay,
        showOnce: centerBannerShowOnce,
        sessionKey: centerBannerSessionKey,
        sessionValue: sessionStorage.getItem(centerBannerSessionKey)
      });
      
      if (centerBannerEnabled && !centerBannerShown && !isOpen) {
        console.log('[Hi Chroney] Center banner scheduled in', centerBannerDelay, 'seconds');
        setTimeout(() => {
          showCenterBanner();
        }, centerBannerDelay * 1000);
      } else {
        console.log('[Hi Chroney] Center banner NOT scheduled. Reason:', 
          !centerBannerEnabled ? 'disabled' : 
          centerBannerShown ? 'already shown' : 
          isOpen ? 'chat is open' : 'unknown');
      }
      
      // Append elements
      container.appendChild(button);
      document.body.appendChild(container);
      if (widgetStartersContainer) {
        document.body.appendChild(widgetStartersContainer);
      }
      document.body.appendChild(iframe);
      
      // CRITICAL: Force visibility immediately after appending to DOM
      // This ensures the button is visible even if host website CSS hides it
      if (!isOpen) {
        // Chat is closed, button should be visible
        button.dataset.forceHidden = 'false';
        forceWidgetVisibility(container, button);
        console.log('[Hi Chroney] Initial visibility enforcement applied');
      }
      
      // Set up recurring visibility enforcement for host websites that dynamically apply CSS
      // Only enforce when chat is closed (button should be visible)
      const visibilityEnforcementInterval = setInterval(() => {
        // Check if button should be visible (chat is closed and not intentionally hidden)
        if (!isOpen && button.dataset.forceHidden !== 'true') {
          const buttonStyle = getComputedStyle(button);
          // Only enforce if button is actually hidden by host CSS
          if (buttonStyle.display === 'none' || buttonStyle.visibility === 'hidden' || parseFloat(buttonStyle.opacity) === 0) {
            console.log('[Hi Chroney] Periodic visibility enforcement - button was hidden by host');
            forceWidgetVisibility(container, button);
          }
        }
      }, 500); // Check every 500ms
      
      // Store interval reference for cleanup (if needed in future)
      container._visibilityInterval = visibilityEnforcementInterval;
    }
  };

  // Mobile viewport height calculator - handles dynamic browser UI
  function updateMobileViewportHeight() {
    // Only run on mobile devices
    if (window.innerWidth <= 480) {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--hichroney-vh', `${vh}px`);
    }
  }

  // Update viewport height on resize, orientation change, and initial load
  let resizeTimeout;
  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(updateMobileViewportHeight, 100);
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', updateMobileViewportHeight);
  updateMobileViewportHeight(); // Initial calculation

  // ============================================================================
  // BEHAVIORAL DISCOUNT SYSTEM - Smart Intent Tracking
  // ============================================================================
  
  const VisitorSession = {
    sessionId: null,

    init() {
      const STORAGE_KEY = 'hichroney_visitor_session';
      const SESSION_DURATION = 30 * 60 * 1000;
      
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const { sessionId, timestamp } = JSON.parse(stored);
          if (Date.now() - timestamp < SESSION_DURATION) {
            this.sessionId = sessionId;
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, timestamp: Date.now() }));
            return;
          }
        }
        
        const newSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: newSessionId, timestamp: Date.now() }));
        this.sessionId = newSessionId;
      } catch (e) {
        this.sessionId = 'temp_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
      }
      
      console.log('[VisitorSession] Session ID:', this.sessionId);
    }
  };

  // ============================================================================
  // EXIT INTENT TRACKER - Detects when user moves mouse toward browser top
  // ============================================================================
  
  const ExitIntentTracker = {
    config: null,
    settings: null,
    isEnabled: false,
    hasTriggered: false,
    apiBaseUrl: null,
    
    init(config) {
      if (!config || !config.businessId) {
        console.log('[Exit Intent] No business ID provided, disabled');
        return;
      }
      
      this.config = config;
      this.apiBaseUrl = config.apiBaseUrl || window.location.origin;
      
      // Fetch settings from API
      this.fetchSettings();
    },
    
    async fetchSettings() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/exit-intent-settings/public?businessAccountId=${encodeURIComponent(this.config.businessId)}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (response.ok) {
          this.settings = await response.json();
          console.log('[Exit Intent] Settings loaded:', this.settings);
          
          if (this.settings.isEnabled) {
            this.isEnabled = true;
            this.startTracking();
          }
        } else {
          console.log('[Exit Intent] No settings found or API unavailable');
        }
      } catch (error) {
        console.warn('[Exit Intent] Failed to fetch settings:', error);
      }
    },
    
    startTracking() {
      if (!this.isEnabled) return;
      
      // Use combination of UA and touch capability for mobile detection
      const isMobileUA = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const hasTouchOnly = ('ontouchstart' in window) && !window.matchMedia('(pointer: fine)').matches;
      const isMobile = isMobileUA || hasTouchOnly;
      
      if (isMobile && this.settings.mobileExitEnabled !== false) {
        // Mobile exit detection (visibility + back button)
        console.log('[Exit Intent] Mobile device detected - enabling mobile tracking');
        this.startMobileTracking();
      } else if (isMobile) {
        console.log('[Exit Intent] Mobile tracking disabled in settings');
      }
      
      // Always enable desktop mouse tracking (unless confirmed touch-only device)
      if (!hasTouchOnly) {
        document.addEventListener('mouseout', (e) => this.handleMouseOut(e));
        console.log('[Exit Intent] Desktop mouse tracking started');
      }
    },
    
    startMobileTracking() {
      // 1. Page Visibility API - detect when user switches tabs/apps
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && !this.hasTriggered) {
          console.log('[Exit Intent] Mobile: Page hidden - user switching away');
          this.triggerExitIntent();
        }
      });
      
      // 2. Back button detection (Android) - push state and intercept popstate
      try {
        // Push a dummy state to enable back button interception
        history.pushState({ hichroneyExitIntent: true }, '', location.href);
        
        window.addEventListener('popstate', (event) => {
          if (!this.hasTriggered) {
            console.log('[Exit Intent] Mobile: Back button pressed');
            // Re-push state to keep user on page while showing discount
            history.pushState({ hichroneyExitIntent: true }, '', location.href);
            this.triggerExitIntent();
          }
        });
      } catch (e) {
        console.log('[Exit Intent] Could not set up back button detection:', e.message);
      }
      
      console.log('[Exit Intent] Mobile tracking started (visibility + back button)');
    },
    
    handleMouseOut(e) {
      if (this.hasTriggered || !this.isEnabled) return;
      
      // Check if mouse is leaving through top of viewport
      if (e.clientY <= 0 && e.relatedTarget === null) {
        console.log('[Exit Intent] Exit intent detected!');
        this.triggerExitIntent();
      }
    },
    
    async triggerExitIntent() {
      if (this.hasTriggered) return;
      
      // Check cooldown and max uses with localStorage fallback
      const cooldownKey = `hichroney_exit_intent_cooldown_${this.config.businessId}`;
      const usesKey = `hichroney_exit_intent_uses_${this.config.businessId}`;
      let lastTrigger = null;
      let uses = 0;
      
      try {
        lastTrigger = localStorage.getItem(cooldownKey);
        uses = parseInt(localStorage.getItem(usesKey) || '0');
      } catch (e) {
        // localStorage unavailable (Safari private mode, embedded iframes, etc.)
        // Fall back to in-memory tracking - discount will trigger once per page load
        console.log('[Exit Intent] localStorage unavailable, using in-memory tracking');
      }
      
      if (lastTrigger) {
        const cooldownMs = (this.settings.cooldownMinutes || 1440) * 60 * 1000;
        if (Date.now() - parseInt(lastTrigger) < cooldownMs) {
          console.log('[Exit Intent] Still in cooldown period');
          return;
        }
      }
      
      if (uses >= (this.settings.maxUsesPerVisitor || 1)) {
        console.log('[Exit Intent] Max uses reached for this visitor');
        return;
      }
      
      // Check if cart has items (if required)
      if (this.settings.requireCartItems) {
        const hasCart = this.detectCartItems();
        if (!hasCart) {
          console.log('[Exit Intent] Cart items required but none detected');
          return;
        }
      }
      
      this.hasTriggered = true;
      
      // Update cooldown and uses (with error handling)
      try {
        localStorage.setItem(cooldownKey, Date.now().toString());
        localStorage.setItem(usesKey, (uses + 1).toString());
      } catch (e) {
        // Silently fail - tracking will be per-page-load only
        console.log('[Exit Intent] Could not persist to localStorage');
      }
      
      // Prepare discount message
      const discountMessage = (this.settings.discountMessage || "Wait! Here's {discount}% off before you go!")
        .replace('{discount}', this.settings.discountPercentage || 10);
      
      // Trigger chatbot with discount message
      this.openChatWithMessage(discountMessage, 'exit_intent');
      
      console.log('[Exit Intent] Discount triggered:', discountMessage);
    },
    
    detectCartItems() {
      // Try to detect cart items from common e-commerce platforms
      try {
        // Shopify
        if (window.Shopify && window.Shopify.checkout && window.Shopify.checkout.line_items) {
          return window.Shopify.checkout.line_items.length > 0;
        }
        
        // Check for cart count elements
        const cartCountSelectors = [
          '.cart-count', '.cart-item-count', '[data-cart-count]',
          '.minicart-quantity', '.cart-items-count', '#cart-count'
        ];
        for (const selector of cartCountSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            const count = parseInt(el.textContent || '0');
            if (count > 0) return true;
          }
        }
        
        // Check localStorage for cart data
        const cartKeys = ['cart', 'shopping_cart', 'cartItems'];
        for (const key of cartKeys) {
          const data = localStorage.getItem(key);
          if (data) {
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed) && parsed.length > 0) return true;
              if (parsed && parsed.items && parsed.items.length > 0) return true;
            } catch (e) {}
          }
        }
        
        return false;
      } catch (e) {
        console.warn('[Exit Intent] Cart detection failed:', e);
        return false;
      }
    },
    
    openChatWithMessage(message, triggerType) {
      console.log('[Exit Intent] ========== OPEN CHAT WITH MESSAGE ==========');
      
      const sendDiscountMessage = () => {
        const iframe = document.getElementById('hichroney-widget-iframe');
        if (iframe && iframe.contentWindow && HiChroneyWidget._iframeReady) {
          iframe.contentWindow.postMessage({
            type: 'HICHRONEY_DISCOUNT_TRIGGER',
            triggerType: triggerType,
            message: message,
            discountPercentage: this.settings.discountPercentage,
            expiryMinutes: this.settings.expiryMinutes
          }, '*');
          console.log('[Exit Intent] postMessage sent!');
          return true;
        }
        return false;
      };
      
      // First, open the chat widget if closed (check 'open' class to avoid toggling it closed)
      const widgetButton = document.getElementById('hichroney-widget-button');
      if (widgetButton && !widgetButton.classList.contains('open')) {
        widgetButton.click();
        console.log('[Exit Intent] Clicked widget button to open chat');
      } else if (widgetButton) {
        console.log('[Exit Intent] Widget already open, skipping click');
      } else {
        const pill = document.querySelector('.hichroney-pill');
        if (pill && !pill.classList.contains('pill--hidden')) {
          pill.click();
        }
      }
      
      // Try to send message immediately, or retry until iframe is ready
      if (!sendDiscountMessage()) {
        console.log('[Exit Intent] Iframe not ready, will retry...');
        let attempts = 0;
        const maxAttempts = 30;
        const retryInterval = setInterval(() => {
          attempts++;
          if (sendDiscountMessage() || attempts >= maxAttempts) {
            clearInterval(retryInterval);
          }
        }, 200);
      }
    }
  };

  // ============================================================================
  // IDLE TIMEOUT TRACKER - Detects visitor inactivity
  // ============================================================================
  
  const IdleTimeoutTracker = {
    config: null,
    settings: null,
    isEnabled: false,
    hasTriggered: false,
    apiBaseUrl: null,
    idleTimer: null,
    lastActivityTime: Date.now(),
    
    init(config) {
      console.log('[Idle Timeout] ========== INIT CALLED ==========');
      console.log('[Idle Timeout] Config received:', config);
      
      if (!config || !config.businessId) {
        console.log('[Idle Timeout] No business ID provided, disabled');
        return;
      }
      
      this.config = config;
      this.apiBaseUrl = config.apiBaseUrl || window.location.origin;
      console.log('[Idle Timeout] API Base URL:', this.apiBaseUrl);
      
      // Fetch settings from API
      this.fetchSettings();
    },
    
    async fetchSettings() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/idle-timeout-settings/public?businessAccountId=${encodeURIComponent(this.config.businessId)}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (response.ok) {
          this.settings = await response.json();
          console.log('[Idle Timeout] Settings loaded:', this.settings);
          
          if (this.settings.isEnabled) {
            this.isEnabled = true;
            this.startTracking();
          }
        } else {
          console.log('[Idle Timeout] No settings found or API unavailable');
        }
      } catch (error) {
        console.warn('[Idle Timeout] Failed to fetch settings:', error);
      }
    },
    
    startTracking() {
      console.log('[Idle Timeout] ========== START TRACKING ==========');
      console.log('[Idle Timeout] isEnabled:', this.isEnabled);
      console.log('[Idle Timeout] hasTriggered:', this.hasTriggered);
      
      if (!this.isEnabled) {
        console.log('[Idle Timeout] Not enabled, aborting startTracking');
        return;
      }
      
      // Check localStorage state
      const cooldownKey = `hichroney_idle_timeout_cooldown_${this.config.businessId}`;
      const usesKey = `hichroney_idle_timeout_uses_${this.config.businessId}`;
      try {
        const lastTrigger = localStorage.getItem(cooldownKey);
        const uses = localStorage.getItem(usesKey);
        console.log('[Idle Timeout] localStorage state - lastTrigger:', lastTrigger, 'uses:', uses);
        console.log('[Idle Timeout] maxUsesPerVisitor:', this.settings.maxUsesPerVisitor);
        console.log('[Idle Timeout] cooldownMinutes:', this.settings.cooldownMinutes);
      } catch (e) {
        console.log('[Idle Timeout] localStorage not accessible');
      }
      
      // Reset timer on any user activity
      const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
      activityEvents.forEach(event => {
        document.addEventListener(event, () => this.resetIdleTimer(), { passive: true });
      });
      
      // Start the idle timer
      this.resetIdleTimer();
      console.log('[Idle Timeout] Tracking started, timeout:', this.settings.idleTimeoutSeconds, 'seconds');
    },
    
    resetIdleTimer() {
      this.lastActivityTime = Date.now();
      
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
      
      if (!this.isEnabled || this.hasTriggered) return;
      
      const timeoutMs = (this.settings.idleTimeoutSeconds || 120) * 1000;
      this.idleTimer = setTimeout(() => this.triggerIdleTimeout(), timeoutMs);
    },
    
    async triggerIdleTimeout() {
      console.log('[Idle Timeout] ========== TRIGGER CALLED ==========');
      console.log('[Idle Timeout] hasTriggered:', this.hasTriggered);
      console.log('[Idle Timeout] isEnabled:', this.isEnabled);
      
      if (this.hasTriggered || !this.isEnabled) {
        console.log('[Idle Timeout] Already triggered or not enabled, aborting');
        return;
      }
      
      // Check cooldown and max uses with localStorage fallback
      const cooldownKey = `hichroney_idle_timeout_cooldown_${this.config.businessId}`;
      const usesKey = `hichroney_idle_timeout_uses_${this.config.businessId}`;
      let lastTrigger = null;
      let uses = 0;
      
      try {
        lastTrigger = localStorage.getItem(cooldownKey);
        uses = parseInt(localStorage.getItem(usesKey) || '0');
      } catch (e) {
        // localStorage unavailable (Safari private mode, embedded iframes, etc.)
        // Fall back to in-memory tracking - discount will trigger once per page load
        console.log('[Idle Timeout] localStorage unavailable, using in-memory tracking');
      }
      
      if (lastTrigger) {
        const cooldownMs = (this.settings.cooldownMinutes || 1440) * 60 * 1000;
        if (Date.now() - parseInt(lastTrigger) < cooldownMs) {
          console.log('[Idle Timeout] Still in cooldown period');
          return;
        }
      }
      
      if (uses >= (this.settings.maxUsesPerVisitor || 1)) {
        console.log('[Idle Timeout] Max uses reached for this visitor');
        return;
      }
      
      // Check if cart has items (if required)
      if (this.settings.requireCartItems) {
        const hasCart = this.detectCartItems();
        if (!hasCart) {
          console.log('[Idle Timeout] Cart items required but none detected');
          return;
        }
      }
      
      this.hasTriggered = true;
      console.log('[Idle Timeout] Passed all checks, triggering discount!');
      
      // Update cooldown and uses (with error handling)
      try {
        localStorage.setItem(cooldownKey, Date.now().toString());
        localStorage.setItem(usesKey, (uses + 1).toString());
        console.log('[Idle Timeout] Updated localStorage - uses now:', uses + 1);
      } catch (e) {
        // Silently fail - tracking will be per-page-load only
        console.log('[Idle Timeout] Could not persist to localStorage');
      }
      
      // Prepare discount message
      const discountMessage = (this.settings.discountMessage || "Still thinking? Here's {discount}% off!")
        .replace('{discount}', this.settings.discountPercentage || 10);
      console.log('[Idle Timeout] Discount message:', discountMessage);
      
      // Trigger chatbot with discount message
      this.openChatWithMessage(discountMessage, 'idle_timeout');
      
      
      console.log('[Idle Timeout] Discount triggered:', discountMessage);
    },
    
    detectCartItems() {
      // Same logic as ExitIntentTracker
      return ExitIntentTracker.detectCartItems.call(this);
    },
    
    openChatWithMessage(message, triggerType) {
      console.log('[Idle Timeout] ========== OPEN CHAT WITH MESSAGE ==========');
      console.log('[Idle Timeout] Message:', message);
      console.log('[Idle Timeout] Trigger type:', triggerType);
      
      const sendDiscountMessage = () => {
        const iframe = document.getElementById('hichroney-widget-iframe');
        console.log('[Idle Timeout] Found iframe:', !!iframe);
        console.log('[Idle Timeout] Iframe ready:', HiChroneyWidget._iframeReady);
        
        if (iframe && iframe.contentWindow && HiChroneyWidget._iframeReady) {
          console.log('[Idle Timeout] Sending postMessage to iframe...');
          iframe.contentWindow.postMessage({
            type: 'HICHRONEY_DISCOUNT_TRIGGER',
            triggerType: triggerType,
            message: message,
            discountPercentage: this.settings.discountPercentage,
            expiryMinutes: this.settings.expiryMinutes
          }, '*');
          console.log('[Idle Timeout] postMessage sent!');
          return true;
        }
        return false;
      };
      
      // First, open the chat widget if closed (check 'open' class to avoid toggling it closed)
      const widgetButton = document.getElementById('hichroney-widget-button');
      console.log('[Idle Timeout] Found widget button:', !!widgetButton);
      if (widgetButton && !widgetButton.classList.contains('open')) {
        widgetButton.click();
        console.log('[Idle Timeout] Clicked widget button to open chat');
      } else if (widgetButton) {
        console.log('[Idle Timeout] Widget already open, skipping click');
      } else {
        const pill = document.querySelector('.hichroney-pill');
        if (pill && !pill.classList.contains('pill--hidden')) {
          pill.click();
          console.log('[Idle Timeout] Clicked pill to open chat');
        }
      }
      
      // Try to send message immediately, or retry until iframe is ready
      if (!sendDiscountMessage()) {
        console.log('[Idle Timeout] Iframe not ready, will retry...');
        let attempts = 0;
        const maxAttempts = 30;
        const retryInterval = setInterval(() => {
          attempts++;
          console.log('[Idle Timeout] Retry attempt:', attempts);
          if (sendDiscountMessage() || attempts >= maxAttempts) {
            clearInterval(retryInterval);
            if (attempts >= maxAttempts) {
              console.log('[Idle Timeout] Max retries reached, giving up');
            }
          }
        }, 200);
      }
    }
  };

  function validateWidgetPhone(phone) {
    var digits = phone.replace(/\D/g, '');
    if (digits.length !== 10) {
      return { isValid: false, message: 'Please enter a valid 10-digit mobile number' };
    }
    var first = digits[0];
    if (first !== '6' && first !== '7' && first !== '8' && first !== '9') {
      return { isValid: false, message: 'Mobile number must start with 6, 7, 8, or 9' };
    }
    var allSame = true;
    for (var i = 1; i < digits.length; i++) {
      if (digits[i] !== digits[0]) { allSame = false; break; }
    }
    if (allSame) {
      return { isValid: false, message: 'Phone number cannot have all same digits' };
    }
    var seqAsc = true;
    for (var i = 1; i < digits.length; i++) {
      if (parseInt(digits[i]) !== (parseInt(digits[i - 1]) + 1) % 10) { seqAsc = false; break; }
    }
    if (seqAsc) {
      return { isValid: false, message: 'Phone number cannot be a sequential number' };
    }
    var seqDesc = true;
    for (var i = 1; i < digits.length; i++) {
      if (parseInt(digits[i]) !== (parseInt(digits[i - 1]) - 1 + 10) % 10) { seqDesc = false; break; }
    }
    if (seqDesc) {
      return { isValid: false, message: 'Phone number cannot be a sequential number' };
    }
    return { isValid: true, message: '' };
  }

  // ===== URGENCY OFFER (renders on parent page, outside chat iframe) =====
  var _urgencyOfferEl = null;
  var _urgencyOfferTimer = null;
  var _urgencyOfferData = null;
  var _urgencyOfferIframe = null;

  function removeUrgencyOffer() {
    if (_urgencyOfferEl) {
      _urgencyOfferEl.style.opacity = '0';
      _urgencyOfferEl.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(function() {
        if (_urgencyOfferEl && _urgencyOfferEl.parentNode) {
          _urgencyOfferEl.parentNode.removeChild(_urgencyOfferEl);
        }
        _urgencyOfferEl = null;
      }, 300);
    }
    if (_urgencyOfferTimer) {
      clearInterval(_urgencyOfferTimer);
      _urgencyOfferTimer = null;
    }
    _urgencyOfferData = null;
  }

  function showUrgencyOfferSuccess() {
    if (!_urgencyOfferEl || !_urgencyOfferData) return;
    var s = _urgencyOfferData.settings;
    var inner = _urgencyOfferEl.querySelector('.hc-offer-inner');
    if (!inner) return;
    inner.innerHTML =
      '<div style="height:6px;background:linear-gradient(90deg,#22c55e,#10b981);border-radius:12px 12px 0 0;"></div>' +
      '<div style="padding:20px;">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
          '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#22c55e,#10b981);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(34,197,94,0.2);">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' +
          '</div>' +
          '<div style="flex:1;">' +
            '<div style="font-weight:700;color:#111;font-size:15px;">Offer Claimed!</div>' +
            '<div style="color:#6b7280;font-size:12px;margin-top:2px;">' + (s.successMessage || 'Your discount has been applied!') + '</div>' +
          '</div>' +
        '</div>' +
        '<button id="hc-offer-continue" style="width:100%;padding:10px;border-radius:12px;border:none;font-size:14px;font-weight:600;color:#15803d;background:#f0fdf4;cursor:pointer;">Continue Browsing</button>' +
      '</div>';
    var btn = inner.querySelector('#hc-offer-continue');
    if (btn) {
      btn.onmouseover = function() { btn.style.background = '#dcfce7'; };
      btn.onmouseout = function() { btn.style.background = '#f0fdf4'; };
      btn.onclick = function() {
        if (_urgencyOfferIframe && _urgencyOfferIframe.contentWindow) {
          _urgencyOfferIframe.contentWindow.postMessage({ type: 'URGENCY_OFFER_ACKNOWLEDGE' }, '*');
        }
        removeUrgencyOffer();
      };
    }
  }

  function showUrgencyOfferError(msg) {
    var errEl = _urgencyOfferEl ? _urgencyOfferEl.querySelector('.hc-offer-error') : null;
    if (errEl) {
      errEl.textContent = msg || 'Something went wrong';
      errEl.style.display = 'block';
    }
    var claimBtn = _urgencyOfferEl ? _urgencyOfferEl.querySelector('#hc-offer-claim') : null;
    if (claimBtn) {
      claimBtn.disabled = false;
      claimBtn.textContent = _urgencyOfferData ? (_urgencyOfferData.settings.ctaButtonText || 'Unlock Offer') : 'Retry';
    }
  }

  function renderUrgencyOffer(offer, iframe) {
    if (_urgencyOfferEl) removeUrgencyOffer();
    _urgencyOfferData = offer;
    _urgencyOfferIframe = iframe;

    var s = offer.settings;
    var accent = offer.accentColor || '#8B5CF6';
    var endTime = new Date(offer.expiresAt).getTime();
    var startTime = new Date(offer.startedAt).getTime();
    var countdownSec = Math.max(0, Math.floor((endTime - startTime) / 1000));

    function getTimeLeft() { return Math.max(0, Math.floor((endTime - Date.now()) / 1000)); }
    function fmt(sec) { return Math.floor(sec/60) + ':' + ('0' + (sec%60)).slice(-2); }
    function discountText() { return s.discountType === 'percentage' ? s.discountValue + '%' : '\u20B9' + s.discountValue; }

    if (getTimeLeft() <= 0) return;

    var el = document.createElement('div');
    el.id = 'hc-urgency-offer';
    el.style.cssText = 'position:fixed;z-index:2147483646;bottom:24px;left:24px;max-width:340px;width:calc(100% - 48px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateY(20px) scale(0.95);transition:opacity 0.5s ease,transform 0.5s ease;';

    var showPhone = s.requirePhone;
    var phoneMode = false;

    function buildCard() {
      var tl = getTimeLeft();
      var pct = (tl / countdownSec) * 100;
      var urgent = tl < 120;
      var html =
        '<div class="hc-offer-inner" style="border-radius:16px;overflow:hidden;background:rgba(255,255,255,0.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 20px 60px rgba(0,0,0,0.15),0 0 0 1px rgba(0,0,0,0.05);">' +
          '<div style="position:relative;height:5px;background:#f3f4f6;overflow:hidden;border-radius:16px 16px 0 0;">' +
            '<div id="hc-offer-progress" style="position:absolute;left:0;top:0;bottom:0;width:' + pct + '%;background:linear-gradient(90deg,' + accent + ',' + accent + 'cc);transition:width 1s linear;border-radius:0 4px 4px 0;"></div>' +
          '</div>' +
          '<div style="padding:16px 16px 14px;">' +
            '<button id="hc-offer-close" style="position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;background:#f3f4f6;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
            '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;padding-right:24px;">' +
              '<div style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,' + accent + ',' + accent + 'dd);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 20px ' + accent + '30;">' +
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>' +
              '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-weight:700;color:#111;font-size:15px;line-height:1.3;">' + (s.headline || 'Special Offer!') + '</div>' +
                '<div style="color:#6b7280;font-size:12px;margin-top:2px;line-height:1.4;">' + (s.description || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
              (s.discountValue > 0 ? '<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:' + accent + '14;color:' + accent + ';">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>' +
                '<span style="font-size:14px;font-weight:700;">' + discountText() + ' OFF</span>' +
              '</div>' : '') +
              '<div style="display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:600;' + (urgent ? 'background:#fef2f2;color:#dc2626;' : 'background:#f9fafb;color:#4b5563;') + '">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + (urgent ? ' style="animation:hcPulse 1s infinite;"' : '') + '><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
                '<span id="hc-offer-timer" style="font-family:ui-monospace,monospace;">' + fmt(tl) + '</span>' +
              '</div>' +
            '</div>';

      if (phoneMode) {
        html +=
          '<div>' +
            '<label style="font-size:12px;font-weight:500;color:#4b5563;display:block;margin-bottom:6px;">' + (s.phoneInputLabel || 'Enter your mobile number') + '</label>' +
            '<div style="position:relative;margin-bottom:8px;">' +
              '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
              '<input id="hc-offer-phone" type="tel" placeholder="' + (s.phoneInputPlaceholder || 'Mobile Number') + '" style="width:100%;box-sizing:border-box;padding:10px 16px 10px 40px;border-radius:12px;border:1px solid #e5e7eb;background:#f9fafb;font-size:14px;color:#111;outline:none;transition:border-color 0.2s,box-shadow 0.2s;" />' +
            '</div>' +
            '<div class="hc-offer-error" style="display:none;color:#ef4444;font-size:12px;margin-bottom:6px;"></div>' +
            '<div style="display:flex;gap:8px;">' +
              '<button id="hc-offer-back" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:14px;font-weight:500;color:#4b5563;background:#f3f4f6;cursor:pointer;transition:background 0.2s;">Back</button>' +
              '<button id="hc-offer-claim" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:14px;font-weight:600;color:white;background:linear-gradient(135deg,' + accent + ',' + accent + 'dd);cursor:pointer;box-shadow:0 4px 14px ' + accent + '40;transition:box-shadow 0.2s,transform 0.1s;">Claim Now</button>' +
            '</div>' +
          '</div>';
      } else {
        html +=
          '<div style="display:flex;gap:8px;">' +
            '<button id="hc-offer-dismiss" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:14px;font-weight:500;color:#6b7280;background:transparent;cursor:pointer;transition:background 0.2s,color 0.2s;">' + (s.dismissButtonText || 'Maybe later') + '</button>' +
            '<button id="hc-offer-cta" style="flex:1;padding:10px;border-radius:12px;border:none;font-size:14px;font-weight:600;color:white;background:linear-gradient(135deg,' + accent + ',' + accent + 'dd);cursor:pointer;box-shadow:0 4px 14px ' + accent + '40;transition:box-shadow 0.2s,transform 0.1s;">' + (s.ctaButtonText || 'Unlock Offer') + '</button>' +
          '</div>';
      }

      html += '</div></div>';
      return html;
    }

    el.innerHTML = buildCard();
    document.body.appendChild(el);
    _urgencyOfferEl = el;

    // Inject pulse animation
    if (!document.getElementById('hc-offer-styles')) {
      var style = document.createElement('style');
      style.id = 'hc-offer-styles';
      style.textContent = '@keyframes hcPulse{0%,100%{opacity:1}50%{opacity:0.4}}';
      document.head.appendChild(style);
    }

    // Animate in
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.style.opacity = '1';
        el.style.transform = 'translateY(0) scale(1)';
      });
    });

    function bindEvents() {
      var closeBtn = el.querySelector('#hc-offer-close');
      var dismissBtn = el.querySelector('#hc-offer-dismiss');
      var ctaBtn = el.querySelector('#hc-offer-cta');
      var backBtn = el.querySelector('#hc-offer-back');
      var claimBtn = el.querySelector('#hc-offer-claim');
      var phoneInput = el.querySelector('#hc-offer-phone');

      if (closeBtn) {
        closeBtn.onmouseover = function() { closeBtn.style.background = '#e5e7eb'; };
        closeBtn.onmouseout = function() { closeBtn.style.background = '#f3f4f6'; };
        closeBtn.onclick = function() {
          iframe.contentWindow.postMessage({ type: 'URGENCY_OFFER_DISMISS' }, '*');
          removeUrgencyOffer();
        };
      }
      if (dismissBtn) {
        dismissBtn.onmouseover = function() { dismissBtn.style.background = '#f3f4f6'; dismissBtn.style.color = '#374151'; };
        dismissBtn.onmouseout = function() { dismissBtn.style.background = 'transparent'; dismissBtn.style.color = '#6b7280'; };
        dismissBtn.onclick = function() {
          iframe.contentWindow.postMessage({ type: 'URGENCY_OFFER_DISMISS' }, '*');
          removeUrgencyOffer();
        };
      }
      if (ctaBtn) {
        ctaBtn.onmouseover = function() { ctaBtn.style.boxShadow = '0 8px 24px ' + accent + '50'; };
        ctaBtn.onmouseout = function() { ctaBtn.style.boxShadow = '0 4px 14px ' + accent + '40'; };
        ctaBtn.onmousedown = function() { ctaBtn.style.transform = 'scale(0.98)'; };
        ctaBtn.onmouseup = function() { ctaBtn.style.transform = 'scale(1)'; };
        ctaBtn.onclick = function() {
          if (showPhone) {
            phoneMode = true;
            el.innerHTML = buildCard();
            bindEvents();
            var pi = el.querySelector('#hc-offer-phone');
            if (pi) { pi.focus(); pi.addEventListener('focus', function() { pi.style.borderColor = accent; pi.style.boxShadow = '0 0 0 3px ' + accent + '20'; }); pi.addEventListener('blur', function() { pi.style.borderColor = '#e5e7eb'; pi.style.boxShadow = 'none'; }); }
          } else {
            ctaBtn.disabled = true;
            ctaBtn.textContent = 'Claiming...';
            iframe.contentWindow.postMessage({ type: 'URGENCY_OFFER_REDEEM', phoneNumber: '' }, '*');
          }
        };
      }
      if (backBtn) {
        backBtn.onmouseover = function() { backBtn.style.background = '#e5e7eb'; };
        backBtn.onmouseout = function() { backBtn.style.background = '#f3f4f6'; };
        backBtn.onclick = function() {
          phoneMode = false;
          var errEl = el.querySelector('.hc-offer-error');
          if (errEl) errEl.style.display = 'none';
          el.innerHTML = buildCard();
          bindEvents();
        };
      }
      if (claimBtn) {
        claimBtn.onmouseover = function() { claimBtn.style.boxShadow = '0 8px 24px ' + accent + '50'; };
        claimBtn.onmouseout = function() { claimBtn.style.boxShadow = '0 4px 14px ' + accent + '40'; };
        claimBtn.onclick = function() {
          var phone = phoneInput ? phoneInput.value.trim() : '';
          var errEl = el.querySelector('.hc-offer-error');
          if (s.requirePhone && !phone) { if (errEl) { errEl.textContent = 'Please enter your phone number'; errEl.style.display = 'block'; } return; }
          if (s.requirePhone && phone) {
            var phoneCheck = validateWidgetPhone(phone);
            if (!phoneCheck.isValid) { if (errEl) { errEl.textContent = phoneCheck.message; errEl.style.display = 'block'; } return; }
          }
          if (errEl) errEl.style.display = 'none';
          claimBtn.disabled = true;
          claimBtn.textContent = 'Claiming...';
          iframe.contentWindow.postMessage({ type: 'URGENCY_OFFER_REDEEM', phoneNumber: phone }, '*');
        };
      }
      if (phoneInput) {
        phoneInput.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' && claimBtn) claimBtn.click();
        });
      }
    }

    bindEvents();

    // Countdown timer update
    _urgencyOfferTimer = setInterval(function() {
      var tl = getTimeLeft();
      var timerEl = el.querySelector('#hc-offer-timer');
      var progressEl = el.querySelector('#hc-offer-progress');
      if (timerEl) timerEl.textContent = fmt(tl);
      if (progressEl) progressEl.style.width = ((tl / countdownSec) * 100) + '%';
      if (tl <= 0) {
        removeUrgencyOffer();
      }
    }, 1000);

    // Mobile responsive
    if (window.innerWidth <= 480) {
      el.style.left = '12px';
      el.style.right = '12px';
      el.style.bottom = '12px';
      el.style.maxWidth = 'none';
      el.style.width = 'auto';
    }
  }

  // Expose trackers to global scope
  window.ExitIntentTracker = ExitIntentTracker;
  window.IdleTimeoutTracker = IdleTimeoutTracker;

  // Auto-initialize if data-config attribute exists
  window.addEventListener('DOMContentLoaded', function() {
    const script = document.querySelector('script[data-config]');
    if (script) {
      try {
        const config = JSON.parse(script.getAttribute('data-config'));
        HiChroneyWidget.init(config);
      } catch (e) {
        console.error('[Hi Chroney] Failed to parse widget config:', e);
      }
    }
  });

  // Expose to global scope
  window.HiChroneyWidget = HiChroneyWidget;
})();
