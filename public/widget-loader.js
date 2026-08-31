(function() {
  var currentScript = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();
  
  var businessAccountId = currentScript.getAttribute('data-business-id');
  if (!businessAccountId) {
    console.error('[Chroney Widget] Missing data-business-id attribute');
    return;
  }
  
  var apiBase = currentScript.src.replace(/\/widget-loader\.js.*$/, '');
  var config = { businessAccountId: businessAccountId };
  var pendingOpenChat = false;

  // A client can put data-chroney-open-chat on any of its own buttons or
  // links. Capture the click before host-page handlers navigate away, then
  // hand the request to the widget's public API once it is available.
  function findOpenChatTrigger(target) {
    var element = target;
    while (element && element !== document) {
      if (element.nodeType === 1 && element.hasAttribute && element.hasAttribute('data-chroney-open-chat')) {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  function handleOpenChatClick(event) {
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    var trigger = findOpenChatTrigger(event.target);
    if (!trigger) return;

    event.preventDefault();
    if (window.HiChroneyWidget && typeof window.HiChroneyWidget.open === 'function') {
      window.HiChroneyWidget.open();
    } else {
      pendingOpenChat = true;
    }
  }

  // Install this before the loader's async settings/proactive-guidance checks,
  // so a trigger is reliable even while widget.js is still downloading.
  if (!window.__chroneyOpenTriggerBound) {
    window.__chroneyOpenTriggerBound = true;
    document.addEventListener('click', handleOpenChatClick, true);
  }

  // This bridge lets custom client JavaScript call open() immediately after
  // the loader tag, before the dynamically loaded widget.js replaces it.
  if (!window.HiChroneyWidget) {
    window.HiChroneyWidget = {
      open: function() {
        pendingOpenChat = true;
        return false;
      }
    };
  }

  // Grade-scoped widget (TopScholar / K12): a client portal that knows the logged-in
  // student injects their board / medium / grade / subject as data attributes on this
  // same universal snippet. For grade-scoped (education) embeds these are REQUIRED —
  // data-subject in particular is mandatory and the tutor refuses to answer when any
  // scope attribute is missing. When ALL scope attributes are absent the widget behaves
  // exactly as the plain snippet (whole-account). When present they are forwarded into
  // the chat iframe so the server can restrict curriculum answers to that student.
  // Secure mode (signed launch token): the client portal signs board/medium/grade/
  // subject + studentId + name on its server and drops the result into data-token.
  // When the account has "Require signed token" enabled, this is the ONLY trusted
  // source — the plain data-* scope attributes below are ignored server-side.
  var topscholarToken = currentScript.getAttribute('data-token');
  if (topscholarToken) config.topscholarToken = topscholarToken;

  var studentBoard = currentScript.getAttribute('data-board');
  var studentMedium = currentScript.getAttribute('data-medium');
  var studentGrade = currentScript.getAttribute('data-grade');
  var studentSubject = currentScript.getAttribute('data-subject');
  var studentChapter = currentScript.getAttribute('data-chapter');
  if (studentBoard) config.studentBoard = studentBoard;
  if (studentMedium) config.studentMedium = studentMedium;
  if (studentGrade) config.studentGrade = studentGrade;
  if (studentSubject) config.studentSubject = studentSubject;
  // Optional chapter narrowing. When present, the tutor scopes answers down to this
  // chapter on top of the subject; absent => whole-subject (back-compat).
  if (studentChapter) config.studentChapter = studentChapter;
  // Grade-scoped (non-secure) student identity. These are plain attributes — no
  // cryptographic sealing. They let the grade-scoped embed attribute conversations
  // to a stable student (history, per-student rollups) like the signed-token embed,
  // without the signing overhead. A valid signed token (data-token) always wins
  // server-side; these are ignored once "Require signed token" is enabled.
  var studentId = currentScript.getAttribute('data-student-id');
  var studentName = currentScript.getAttribute('data-name');
  if (studentId) config.studentId = studentId;
  if (studentName) config.studentName = studentName;

  // Inline embed mode (TopScholar / K12 only): render the tutor INSIDE a container
  // element on the host page (filling it 100% x 100%) instead of as a floating
  // bubble. data-mode="inline" turns it on; data-container is the id of the div the
  // widget should fill. This is gated server-side by k12EducationEnabled — any
  // non-K12 account that sets these attributes silently falls back to the normal
  // floating widget (see widget.js). data-container defaults to "ai-tutor".
  var widgetMode = currentScript.getAttribute('data-mode');
  var widgetContainer = currentScript.getAttribute('data-container');
  if (widgetMode) config.mode = widgetMode;
  if (widgetContainer) config.container = widgetContainer;
  // Subject is mandatory for grade-scoped (education) embeds. Warn integrators when a
  // grade-scope is present without it — the tutor refuses to answer until a subject is set.
  if ((studentBoard || studentMedium || studentGrade) && !studentSubject) {
    console.warn('[Chroney Widget] data-subject is required for grade-scoped embeds; the tutor will refuse to answer until a subject is provided.');
  }
  
  var VISITOR_KEY = 'chroney_visitor_' + config.businessAccountId;
  var visitorToken = localStorage.getItem(VISITOR_KEY);
  if (!visitorToken) {
    visitorToken = 'v_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    localStorage.setItem(VISITOR_KEY, visitorToken);
  }
  
  var sessionId = 's_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  var currentPageViewId = null;
  var pageStartTime = Date.now();
  var maxScrollDepth = 0;
  var sectionData = {};
  
  function trackPageVisitor() {
    var deviceType = /Mobi|Android/i.test(navigator.userAgent) ? 'mobile' : 
                     /Tablet|iPad/i.test(navigator.userAgent) ? 'tablet' : 'desktop';
    var browserMatch = navigator.userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/i);
    var browser = browserMatch ? browserMatch[1] : 'Unknown';
    var osMatch = navigator.userAgent.match(/(Windows|Mac|Linux|Android|iOS)/i);
    var os = osMatch ? osMatch[1] : 'Unknown';
    
    fetch(apiBase + '/api/widget/page-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessAccountId: config.businessAccountId,
        visitorToken: visitorToken,
        deviceType: deviceType,
        browser: browser,
        os: os,
        userAgent: navigator.userAgent
      })
    }).catch(function() {});
  }
  
  function trackPageView() {
    var pagePath = window.location.pathname;
    var referrerUrl = document.referrer || null;
    
    fetch(apiBase + '/api/widget/page-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessAccountId: config.businessAccountId,
        visitorToken: visitorToken,
        pageUrl: window.location.href,
        pageTitle: document.title,
        pagePath: pagePath,
        sessionId: sessionId,
        referrerUrl: referrerUrl
      })
    }).then(function(r) { return r.json(); })
      .then(function(data) { currentPageViewId = data.pageViewId; })
      .catch(function() {});
  }
  
  function updateScrollDepth() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    var winHeight = window.innerHeight;
    var scrollPercent = Math.round((scrollTop / (docHeight - winHeight)) * 100);
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(scrollPercent, 100));
  }
  
  function setupSectionTracking() {
    if (!('IntersectionObserver' in window)) return;
    
    var sections = document.querySelectorAll('section, article, [data-section], header, main, footer, .section');
    if (sections.length === 0) {
      var headings = document.querySelectorAll('h1, h2, h3');
      headings.forEach(function(h, i) {
        var parent = h.parentElement;
        if (parent && !parent.hasAttribute('data-chroney-section')) {
          parent.setAttribute('data-chroney-section', i);
        }
      });
      sections = document.querySelectorAll('[data-chroney-section]');
    }
    
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var el = entry.target;
        var sectionId = el.id || el.getAttribute('data-section') || el.getAttribute('data-chroney-section') || ('section-' + Array.from(el.parentElement.children).indexOf(el));
        var sectionName = el.getAttribute('aria-label') || (el.querySelector('h1, h2, h3') ? el.querySelector('h1, h2, h3').textContent.substring(0, 50) : sectionId);
        var sectionType = el.tagName.toLowerCase();
        
        if (!sectionData[sectionId]) {
          sectionData[sectionId] = { name: sectionName, type: sectionType, time: 0, visible: false, lastStart: null, index: Object.keys(sectionData).length };
        }
        
        if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
          if (!sectionData[sectionId].visible) {
            sectionData[sectionId].visible = true;
            sectionData[sectionId].lastStart = Date.now();
          }
        } else {
          if (sectionData[sectionId].visible && sectionData[sectionId].lastStart) {
            sectionData[sectionId].time += (Date.now() - sectionData[sectionId].lastStart) / 1000;
            sectionData[sectionId].visible = false;
          }
        }
      });
    }, { threshold: [0, 0.3, 0.5, 1] });
    
    sections.forEach(function(s) { observer.observe(s); });
  }
  
  function sendEngagementData() {
    if (!currentPageViewId) return;
    
    Object.keys(sectionData).forEach(function(id) {
      var s = sectionData[id];
      if (s.visible && s.lastStart) {
        s.time += (Date.now() - s.lastStart) / 1000;
      }
    });
    
    var timeSpent = Math.round((Date.now() - pageStartTime) / 1000);
    updateScrollDepth();
    
    navigator.sendBeacon(apiBase + '/api/widget/page-view/' + currentPageViewId, JSON.stringify({
      timeSpentSeconds: timeSpent,
      scrollDepthPercent: maxScrollDepth
    }));
    
    var sectionsArray = Object.keys(sectionData).map(function(id) {
      var s = sectionData[id];
      return { sectionId: id, sectionName: s.name, sectionType: s.type, sectionIndex: s.index, timeSpentSeconds: Math.round(s.time) };
    }).filter(function(s) { return s.timeSpentSeconds > 0; });
    
    if (sectionsArray.length > 0) {
      navigator.sendBeacon(apiBase + '/api/widget/sections-batch', JSON.stringify({
        businessAccountId: config.businessAccountId,
        pageViewId: currentPageViewId,
        visitorToken: visitorToken,
        sections: sectionsArray
      }));
    }
  }
  
  trackPageVisitor();
  trackPageView();
  setTimeout(setupSectionTracking, 1000);
  window.addEventListener('scroll', updateScrollDepth, { passive: true });
  window.addEventListener('beforeunload', sendEngagementData);
  window.addEventListener('pagehide', sendEngagementData);
  
  var pushState = history.pushState;
  history.pushState = function() {
    sendEngagementData();
    pushState.apply(history, arguments);
    setTimeout(function() {
      pageStartTime = Date.now();
      maxScrollDepth = 0;
      sectionData = {};
      currentPageViewId = null;
      trackPageView();
      setupSectionTracking();
    }, 100);
  };
  
  function checkProactiveGuidanceAndInit() {
    var currentUrl = window.location.pathname + window.location.search;
    
    fetch(apiBase + '/api/public/proactive-guidance-rules/' + encodeURIComponent(config.businessAccountId))
      .then(function(r) { return r.json(); })
      .then(function(rules) {
        var hasMatchingRule = false;
        
        if (rules && rules.length > 0) {
          for (var i = 0; i < rules.length; i++) {
            var rule = rules[i];
            var pattern = rule.urlPattern;
            
            if (pattern === currentUrl) {
              hasMatchingRule = true;
              break;
            }
            
            if (pattern.includes('*')) {
              var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
              var regexPattern = escaped.replace(/\*/g, '.*');
              try {
                var regex = new RegExp('^' + regexPattern + '$');
                if (regex.test(currentUrl)) {
                  hasMatchingRule = true;
                  break;
                }
              } catch (e) {}
            }
            
            if (currentUrl.indexOf(pattern) === 0) {
              hasMatchingRule = true;
              break;
            }
          }
        }
        
        if (hasMatchingRule) {
          console.log('[Chroney Widget] Proactive guidance active - auto-opening chat');
          config.autoOpenChat = 'both';
          config.autoOpenFrequency = 'always';
          config.proactiveGuidanceActive = true;
        }
        
        initWidget();
      })
      .catch(function(err) {
        console.log('[Chroney Widget] Could not check proactive guidance:', err);
        initWidget();
      });
  }
  
  function initWidget() {
    // Expose the base URL globally so widget.js can reliably derive it without
    // scanning script tags (which breaks on Shopify and other platforms that
    // proxy or rewrite external script URLs).
    window.__chroneyBaseUrl = apiBase;

    var script = document.createElement('script');
    script.src = apiBase + '/widget.js';
    script.onload = function() {
      if (window.HiChroneyWidget) {
        window.HiChroneyWidget.init(config);
        if (pendingOpenChat && typeof window.HiChroneyWidget.open === 'function') {
          pendingOpenChat = false;
          window.HiChroneyWidget.open();
        }
      }
    };
    document.body.appendChild(script);
  }
  
  checkProactiveGuidanceAndInit();
})();
