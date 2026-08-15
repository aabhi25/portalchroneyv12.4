(function() {
  'use strict';
  
  var script = document.currentScript;
  if (!script) return;
  
  var businessAccountId = script.getAttribute('data-business-id');
  var campaignId = script.getAttribute('data-campaign-id');
  
  if (!businessAccountId || !campaignId) {
    console.error('[Guidance Widget] Missing required data attributes: data-business-id and data-campaign-id');
    return;
  }
  
  var host = script.src.replace(/\/guidance-widget\.js.*$/, '');
  var iframeId = 'hichroney-guidance-widget-iframe';
  var launcherId = 'hichroney-guidance-widget-launcher';
  var voiceOrbId = 'hichroney-guidance-voice-orb';
  
  function getSourceUrl() {
    return encodeURIComponent(window.location.pathname + window.location.search);
  }
  
  function createLauncher(isFullScreen, settings) {
    var launcher = document.getElementById(launcherId);
    if (launcher) return launcher;
    
    var chatColor = (settings && settings.chatColor) || '#6366f1';
    var chatColorEnd = (settings && settings.chatColorEnd) || '#8b5cf6';
    var buttonStyle = (settings && settings.buttonStyle) || 'circular';
    var avatarType = (settings && settings.avatarType) || '';
    var avatarUrl = (settings && settings.avatarUrl) || '';
    
    var borderRadius = '50%';
    var width = '60px';
    var height = '60px';
    
    if (buttonStyle === 'rounded') {
      borderRadius = '16px';
      width = '60px';
      height = '60px';
    } else if (buttonStyle === 'pill') {
      borderRadius = '28px';
      width = '260px';
      height = '56px';
    } else if (buttonStyle === 'square' || buttonStyle === 'minimal') {
      borderRadius = '8px';
      width = '56px';
      height = '56px';
    }
    
    launcher = document.createElement('div');
    launcher.id = launcherId;
    
    if (buttonStyle === 'pill') {
      var avatarHtml = '';
      if (avatarType && avatarType !== 'none') {
        var avatarSrc;
        if (avatarType === 'custom' && avatarUrl) {
          avatarSrc = avatarUrl.indexOf('http') === 0 ? avatarUrl : host + avatarUrl;
        } else {
          avatarSrc = host + '/avatars/avatar-' + avatarType.replace('preset-', '') + '.png';
        }
        avatarHtml = '<div style="width:48px;height:48px;border-radius:50%;background:#3b82f6;padding:2px;box-sizing:border-box;flex-shrink:0;"><img src="' + avatarSrc + '" alt="Assistant" style="width:100%;height:100%;border-radius:50%;object-fit:cover;border:2px solid white;" /></div>';
      } else {
        avatarHtml = '<div style="width:48px;height:48px;border-radius:50%;background:#3b82f6;padding:2px;box-sizing:border-box;flex-shrink:0;"><div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,' + chatColor + ',' + chatColorEnd + ');display:flex;align-items:center;justify-content:center;border:2px solid white;box-sizing:border-box;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z"/><path d="M19 10l.75 2.25L22 13l-2.25.75L19 16l-.75-2.25L16 13l2.25-.75L19 10z"/></svg></div></div>';
      }
      
      if (!document.getElementById('hichroney-pill-styles')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'hichroney-pill-styles';
        styleEl.textContent = '@keyframes hichroney-typewriter-loop{0%{width:0}30%{width:100%}70%{width:100%}85%{width:0}100%{width:0}}@keyframes hichroney-blink-loop{0%,30%,85%,100%{border-color:transparent}35%,80%{border-color:#9ca3af}37.5%,42.5%,47.5%,52.5%,57.5%,62.5%,67.5%,72.5%,77.5%{border-color:transparent}40%,45%,50%,55%,60%,65%,70%,75%{border-color:#9ca3af}}#hichroney-animated-placeholder{display:inline-block;overflow:hidden;white-space:nowrap;animation:hichroney-typewriter-loop 5s steps(16,end) infinite;border-right:2px solid transparent;width:0}#hichroney-animated-placeholder.typing-complete{animation:hichroney-typewriter-loop 5s steps(16,end) infinite,hichroney-blink-loop 5s step-end infinite}@media(max-width:480px){#' + launcherId + '{width:calc(100vw - 20px)!important;max-width:calc(100vw - 20px)!important;right:10px!important;left:10px!important}#' + iframeId + '{width:100vw!important;height:100vh!important;bottom:0!important;right:0!important;border-radius:0!important}}';
        document.head.appendChild(styleEl);
      }
      
      launcher.innerHTML = '<div style="display:flex;align-items:center;width:100%;height:100%;padding:0 4px;gap:4px;box-sizing:border-box;"><div style="flex-shrink:0;">' + avatarHtml + '</div><div id="hichroney-pill-input-container" style="flex:1;min-width:0;background:white;border-radius:21px;display:flex;align-items:center;padding:0 6px 0 12px;height:42px;box-sizing:border-box;border:2px solid rgba(255,255,255,0.5);position:relative;"><input type="text" id="hichroney-pill-input" style="flex:1;min-width:0;font-size:14px;font-weight:400;color:#374151;background:transparent;border:none;outline:none;padding:0;position:relative;"/><div id="hichroney-placeholder-wrapper" style="position:absolute;left:12px;right:44px;pointer-events:none;display:flex;align-items:center;top:50%;transform:translateY(-50%);"><span id="hichroney-animated-placeholder" class="typing-complete" style="font-size:14px;font-weight:400;color:#9ca3af;">How can I help?</span></div><button id="hichroney-pill-send-btn" style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:#000;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;padding:0;margin-left:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button></div></div>';
      
      launcher.style.cssText = 'position:fixed;bottom:20px;right:20px;width:' + width + ';height:' + height + ';border-radius:' + borderRadius + ';background:linear-gradient(135deg,' + chatColor + ',' + chatColorEnd + ');display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:9999;transition:transform 0.2s ease,box-shadow 0.2s ease;border:1px solid rgba(255,255,255,0.3);';
      
      document.body.appendChild(launcher);
      
      var pillInput = document.getElementById('hichroney-pill-input');
      var pillSendBtn = document.getElementById('hichroney-pill-send-btn');
      var placeholderWrapper = document.getElementById('hichroney-placeholder-wrapper');
      
      function openChatWithMessage(message) {
        var iframe = document.getElementById(iframeId);
        var voiceOrb = document.getElementById(voiceOrbId);
        if (iframe) {
          iframe.style.display = 'block';
          launcher.style.display = 'none';
          if (voiceOrb) voiceOrb.style.display = 'none';
          if (message) {
            setTimeout(function() {
              iframe.contentWindow.postMessage({ type: 'INITIAL_MESSAGE', message: message }, '*');
            }, 500);
          }
        }
      }
      
      if (pillInput) {
        pillInput.onclick = function(e) { e.stopPropagation(); };
        pillInput.oninput = function() {
          if (placeholderWrapper) {
            placeholderWrapper.style.display = pillInput.value ? 'none' : 'flex';
          }
        };
        pillInput.onkeydown = function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            var message = pillInput.value.trim();
            openChatWithMessage(message);
            pillInput.value = '';
            if (placeholderWrapper) placeholderWrapper.style.display = 'flex';
          }
        };
      }
      
      if (pillSendBtn) {
        pillSendBtn.onclick = function(e) {
          e.stopPropagation();
          var message = pillInput ? pillInput.value.trim() : '';
          openChatWithMessage(message);
          if (pillInput) {
            pillInput.value = '';
            if (placeholderWrapper) placeholderWrapper.style.display = 'flex';
          }
        };
      }
      
      launcher.onclick = function(e) {
        var target = e.target;
        if (!target.closest('#hichroney-pill-input-container')) {
          var iframe = document.getElementById(iframeId);
          var voiceOrb = document.getElementById(voiceOrbId);
          if (iframe) {
            iframe.style.display = 'block';
            launcher.style.display = 'none';
            if (voiceOrb) voiceOrb.style.display = 'none';
          }
        }
      };
    } else {
      // Add mobile responsive styles for non-pill launchers
      if (!document.getElementById('hichroney-mobile-styles')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'hichroney-mobile-styles';
        styleEl.textContent = '@media(max-width:480px){#' + iframeId + '{width:100vw!important;height:100vh!important;bottom:0!important;right:0!important;border-radius:0!important}}';
        document.head.appendChild(styleEl);
      }
      
      launcher.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
      launcher.style.cssText = 'position:fixed;bottom:20px;right:20px;width:' + width + ';height:' + height + ';border-radius:' + borderRadius + ';background:linear-gradient(135deg,' + chatColor + ',' + chatColorEnd + ');display:none;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:9999;transition:transform 0.2s ease,box-shadow 0.2s ease;';
      
      launcher.onmouseenter = function() { launcher.style.transform = 'scale(1.05)'; };
      launcher.onmouseleave = function() { launcher.style.transform = 'scale(1)'; };
      launcher.onclick = function() {
        var iframe = document.getElementById(iframeId);
        var voiceOrb = document.getElementById(voiceOrbId);
        if (iframe) {
          iframe.style.display = 'block';
          launcher.style.display = 'none';
          if (voiceOrb) voiceOrb.style.display = 'none';
        }
      };
      
      document.body.appendChild(launcher);
    }
    
    return launcher;
  }
  
  function createIframe(isFullScreen) {
    var iframe = document.getElementById(iframeId);
    if (iframe) {
      iframe.src = host + '/embed/guidance?businessAccountId=' + businessAccountId + '&campaignId=' + campaignId + '&sourceUrl=' + getSourceUrl();
      return iframe;
    }
    
    iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.src = host + '/embed/guidance?businessAccountId=' + businessAccountId + '&campaignId=' + campaignId + '&sourceUrl=' + getSourceUrl();
    iframe.style.cssText = 'position:fixed;' +
      'bottom:' + (isFullScreen ? '0' : '20px') + ';' +
      'right:' + (isFullScreen ? '0' : '20px') + ';' +
      'width:400px;' +
      'height:' + (isFullScreen ? '100vh' : '600px') + ';' +
      'border:none;' +
      'border-radius:' + (isFullScreen ? '0' : '16px') + ';' +
      'box-shadow:0 4px 24px rgba(0,0,0,0.15);' +
      'z-index:9999;';
    document.body.appendChild(iframe);
    return iframe;
  }
  
  var voiceModeIframeId = 'hichroney-guidance-voice-iframe';
  var currentVoiceState = 'idle';
  var voiceOrbSettings = null;
  
  var currentVoiceModeStyle = 'circular';
  
  function createVoiceOrb(settings, voiceModePosition) {
    var voiceOrb = document.getElementById(voiceOrbId);
    if (voiceOrb) return voiceOrb;
    
    voiceOrbSettings = settings;
    var chatColor = (settings && settings.chatColor) || '#6366f1';
    var chatColorEnd = (settings && settings.chatColorEnd) || '#8b5cf6';
    var avatarType = (settings && settings.avatarType) || 'none';
    var avatarUrl = (settings && settings.avatarUrl) || '';
    currentVoiceModeStyle = (settings && settings.voiceModeStyle) || 'circular';
    
    // Add animation styles for different voice states and styles
    if (!document.getElementById('hichroney-voice-orb-styles')) {
      var styleEl = document.createElement('style');
      styleEl.id = 'hichroney-voice-orb-styles';
      styleEl.textContent = 
        // Circular style - smooth breathing
        '@keyframes hichroney-voice-idle-circular{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1)}50%{box-shadow:0 0 25px rgba(147,51,234,0.4);transform:scale(1.02)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1)}}' +
        '@keyframes hichroney-voice-listening-circular{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1)}50%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:scale(1.05)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1)}}' +
        '@keyframes hichroney-voice-thinking-circular{0%{box-shadow:0 0 20px rgba(251,191,36,0.5)}25%{box-shadow:0 0 35px rgba(251,191,36,0.7)}50%{box-shadow:0 0 20px rgba(251,191,36,0.5)}75%{box-shadow:0 0 35px rgba(251,191,36,0.7)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5)}}' +
        '@keyframes hichroney-voice-speaking-circular{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1)}25%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(1.08)}50%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1)}75%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(1.08)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1)}}' +
        // Morphing style - organic breathing with subtle scale
        '@keyframes hichroney-voice-idle-morphing{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) rotate(0deg)}33%{transform:scale(1.03) rotate(2deg)}66%{transform:scale(0.98) rotate(-1deg)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) rotate(0deg)}}' +
        '@keyframes hichroney-voice-listening-morphing{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) rotate(0deg)}25%{transform:scale(1.06) rotate(3deg)}50%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:scale(0.97) rotate(-2deg)}75%{transform:scale(1.04) rotate(1deg)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) rotate(0deg)}}' +
        '@keyframes hichroney-voice-thinking-morphing{0%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) rotate(0deg)}25%{transform:scale(1.05) rotate(5deg)}50%{box-shadow:0 0 35px rgba(251,191,36,0.7);transform:scale(0.96) rotate(-3deg)}75%{transform:scale(1.03) rotate(2deg)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) rotate(0deg)}}' +
        '@keyframes hichroney-voice-speaking-morphing{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) rotate(0deg)}20%{transform:scale(1.1) rotate(4deg)}40%{transform:scale(0.95) rotate(-3deg)}60%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(1.08) rotate(2deg)}80%{transform:scale(0.97) rotate(-1deg)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) rotate(0deg)}}' +
        // Distorted style - wavy fluid blob effect
        '@keyframes hichroney-voice-idle-distorted{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) skewX(0deg)}25%{transform:scale(1.02) skewX(2deg)}50%{transform:scale(0.98) skewX(-1deg)}75%{transform:scale(1.01) skewX(1deg)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) skewX(0deg)}}' +
        '@keyframes hichroney-voice-listening-distorted{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) skewX(0deg) skewY(0deg)}25%{transform:scale(1.08) skewX(4deg) skewY(-2deg)}50%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:scale(0.95) skewX(-3deg) skewY(2deg)}75%{transform:scale(1.05) skewX(2deg) skewY(-1deg)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) skewX(0deg) skewY(0deg)}}' +
        '@keyframes hichroney-voice-thinking-distorted{0%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) skewX(0deg)}20%{transform:scale(1.06) skewX(5deg)}40%{transform:scale(0.94) skewX(-4deg)}60%{box-shadow:0 0 35px rgba(251,191,36,0.7);transform:scale(1.04) skewX(3deg)}80%{transform:scale(0.97) skewX(-2deg)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) skewX(0deg)}}' +
        '@keyframes hichroney-voice-speaking-distorted{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) skewX(0deg) skewY(0deg)}16%{transform:scale(1.12) skewX(6deg) skewY(-3deg)}33%{transform:scale(0.92) skewX(-5deg) skewY(3deg)}50%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(1.1) skewX(4deg) skewY(-2deg)}66%{transform:scale(0.95) skewX(-3deg) skewY(1deg)}83%{transform:scale(1.05) skewX(2deg) skewY(-1deg)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) skewX(0deg) skewY(0deg)}}' +
        // Angular style - sharp geometric pulsing
        '@keyframes hichroney-voice-idle-angular{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) rotate(0deg)}50%{box-shadow:0 0 25px rgba(147,51,234,0.4);transform:scale(1.03) rotate(45deg)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) rotate(0deg)}}' +
        '@keyframes hichroney-voice-listening-angular{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) rotate(0deg)}25%{transform:scale(1.08) rotate(90deg)}50%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:scale(0.95) rotate(180deg)}75%{transform:scale(1.05) rotate(270deg)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) rotate(360deg)}}' +
        '@keyframes hichroney-voice-thinking-angular{0%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) rotate(0deg)}25%{transform:scale(1.05) rotate(45deg)}50%{box-shadow:0 0 35px rgba(251,191,36,0.7);transform:scale(0.97) rotate(90deg)}75%{transform:scale(1.03) rotate(135deg)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) rotate(180deg)}}' +
        '@keyframes hichroney-voice-speaking-angular{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) rotate(0deg)}25%{transform:scale(1.1) rotate(90deg)}50%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(0.93) rotate(180deg)}75%{transform:scale(1.07) rotate(270deg)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) rotate(360deg)}}' +
        // Ocean wave style - flowing wave motion
        '@keyframes hichroney-voice-idle-ocean{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:translateY(0) scale(1)}25%{transform:translateY(-2px) scale(1.01)}50%{transform:translateY(0) scale(0.99)}75%{transform:translateY(2px) scale(1.01)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:translateY(0) scale(1)}}' +
        '@keyframes hichroney-voice-listening-ocean{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:translateY(0) scale(1)}25%{transform:translateY(-4px) scale(1.05)}50%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:translateY(0) scale(0.97)}75%{transform:translateY(4px) scale(1.03)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:translateY(0) scale(1)}}' +
        '@keyframes hichroney-voice-thinking-ocean{0%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:translateY(0) scale(1)}20%{transform:translateY(-3px) scale(1.04)}40%{transform:translateY(2px) scale(0.98)}60%{box-shadow:0 0 35px rgba(251,191,36,0.7);transform:translateY(-2px) scale(1.02)}80%{transform:translateY(3px) scale(0.99)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:translateY(0) scale(1)}}' +
        '@keyframes hichroney-voice-speaking-ocean{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:translateY(0) scale(1)}16%{transform:translateY(-6px) scale(1.08)}33%{transform:translateY(3px) scale(0.95)}50%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:translateY(-4px) scale(1.06)}66%{transform:translateY(5px) scale(0.97)}83%{transform:translateY(-2px) scale(1.03)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:translateY(0) scale(1)}}' +
        // Triangle style - dynamic pyramid motion
        '@keyframes hichroney-voice-idle-triangle{0%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) translateY(0)}50%{box-shadow:0 0 25px rgba(147,51,234,0.4);transform:scale(1.02) translateY(-3px)}100%{box-shadow:0 0 15px rgba(147,51,234,0.3);transform:scale(1) translateY(0)}}' +
        '@keyframes hichroney-voice-listening-triangle{0%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) translateY(0)}33%{transform:scale(1.06) translateY(-5px)}66%{box-shadow:0 0 40px rgba(34,197,94,0.8);transform:scale(0.97) translateY(3px)}100%{box-shadow:0 0 20px rgba(34,197,94,0.5);transform:scale(1) translateY(0)}}' +
        '@keyframes hichroney-voice-thinking-triangle{0%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) translateY(0)}25%{transform:scale(1.04) translateY(-4px)}50%{box-shadow:0 0 35px rgba(251,191,36,0.7);transform:scale(0.98) translateY(2px)}75%{transform:scale(1.02) translateY(-2px)}100%{box-shadow:0 0 20px rgba(251,191,36,0.5);transform:scale(1) translateY(0)}}' +
        '@keyframes hichroney-voice-speaking-triangle{0%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) translateY(0)}20%{transform:scale(1.1) translateY(-8px)}40%{transform:scale(0.94) translateY(4px)}60%{box-shadow:0 0 45px rgba(59,130,246,0.9);transform:scale(1.07) translateY(-6px)}80%{transform:scale(0.97) translateY(2px)}100%{box-shadow:0 0 25px rgba(59,130,246,0.6);transform:scale(1) translateY(0)}}';
      document.head.appendChild(styleEl);
    }
    
    voiceOrb = document.createElement('div');
    voiceOrb.id = voiceOrbId;
    
    // Build avatar HTML - show avatar if configured, fallback to mic icon
    var avatarHtml = '';
    if (avatarType && avatarType !== 'none') {
      var avatarSrc;
      if (avatarType === 'custom' && avatarUrl) {
        avatarSrc = avatarUrl.indexOf('http') === 0 ? avatarUrl : host + avatarUrl;
      } else {
        avatarSrc = host + '/avatars/avatar-' + avatarType.replace('preset-', '') + '.png';
      }
      avatarHtml = '<img src="' + avatarSrc + '" alt="Voice Assistant" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />';
    } else {
      avatarHtml = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>';
    }
    
    // Get style suffix for animations
    var styleSuffix = currentVoiceModeStyle === 'ocean-wave' ? 'ocean' : currentVoiceModeStyle;
    if (!['circular', 'morphing', 'distorted', 'angular', 'ocean', 'triangle'].includes(styleSuffix)) {
      styleSuffix = 'circular';
    }
    
    // Create orb with gradient ring (ring element has id for animation updates) and label
    voiceOrb.innerHTML = '<div style="position:relative;width:50px;height:50px;">' +
      '<div id="hichroney-voice-ring" style="position:absolute;inset:-3px;border-radius:50%;background:linear-gradient(135deg,' + chatColor + ',' + chatColorEnd + ');animation:hichroney-voice-idle-' + styleSuffix + ' 2s ease-in-out infinite;"></div>' +
      '<div style="position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,' + chatColor + ',' + chatColorEnd + ');padding:3px;box-sizing:border-box;">' +
        '<div style="width:100%;height:100%;border-radius:50%;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + avatarHtml + '</div>' +
      '</div>' +
    '</div>' +
    '<div id="hichroney-voice-label" style="position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:11px;font-weight:500;color:#6b7280;background:rgba(255,255,255,0.95);padding:3px 8px;border-radius:10px;box-shadow:0 1px 4px rgba(0,0,0,0.1);transition:all 0.2s ease;">Tap to talk</div>';
    
    // Position based on voiceModePosition - elevated from bottom
    var positionStyles = '';
    if (voiceModePosition === 'bottom-left') {
      positionStyles = 'bottom:50px;left:40px;';
    } else if (voiceModePosition === 'top-right') {
      positionStyles = 'top:20px;right:20px;';
    } else if (voiceModePosition === 'top-left') {
      positionStyles = 'top:20px;left:40px;';
    } else {
      positionStyles = 'bottom:50px;right:100px;';
    }
    
    voiceOrb.style.cssText = 'position:fixed;' + positionStyles + 'width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9998;transition:transform 0.2s ease;';
    
    voiceOrb.onmouseenter = function() { if (currentVoiceState === 'idle') voiceOrb.style.transform = 'scale(1.1)'; };
    voiceOrb.onmouseleave = function() { if (currentVoiceState === 'idle') voiceOrb.style.transform = 'scale(1)'; };
    voiceOrb.onclick = function() {
      toggleVoice();
    };
    
    document.body.appendChild(voiceOrb);
    
    // Create hidden voice iframe immediately
    createHiddenVoiceIframe();
    
    return voiceOrb;
  }
  
  function createHiddenVoiceIframe() {
    var voiceIframe = document.getElementById(voiceModeIframeId);
    if (voiceIframe) return;
    
    voiceIframe = document.createElement('iframe');
    voiceIframe.id = voiceModeIframeId;
    voiceIframe.src = host + '/embed/voice-orb?businessAccountId=' + businessAccountId + '&campaignId=' + campaignId;
    voiceIframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;pointer-events:none;';
    voiceIframe.allow = 'microphone';
    document.body.appendChild(voiceIframe);
  }
  
  function toggleVoice() {
    var voiceIframe = document.getElementById(voiceModeIframeId);
    if (voiceIframe && voiceIframe.contentWindow) {
      voiceIframe.contentWindow.postMessage({ type: 'TOGGLE_VOICE' }, '*');
    }
  }
  
  function updateVoiceOrbAnimation(state) {
    currentVoiceState = state;
    var ring = document.getElementById('hichroney-voice-ring');
    var label = document.getElementById('hichroney-voice-label');
    
    if (ring) {
      // Get style suffix for animations
      var styleSuffix = currentVoiceModeStyle === 'ocean-wave' ? 'ocean' : currentVoiceModeStyle;
      if (!['circular', 'morphing', 'distorted', 'angular', 'ocean', 'triangle'].includes(styleSuffix)) {
        styleSuffix = 'circular';
      }
      
      var animationMap = {
        'idle': 'hichroney-voice-idle-' + styleSuffix + ' 2s ease-in-out infinite',
        'connecting': 'hichroney-voice-thinking-' + styleSuffix + ' 0.8s ease-in-out infinite',
        'listening': 'hichroney-voice-listening-' + styleSuffix + ' 1s ease-in-out infinite',
        'thinking': 'hichroney-voice-thinking-' + styleSuffix + ' 0.6s ease-in-out infinite',
        'speaking': 'hichroney-voice-speaking-' + styleSuffix + ' 0.4s ease-in-out infinite'
      };
      ring.style.animation = animationMap[state] || animationMap['idle'];
    }
    
    if (label) {
      var labelMap = {
        'idle': 'Tap to talk',
        'connecting': 'Connecting...',
        'listening': 'Tap to close',
        'thinking': 'Thinking...',
        'speaking': 'Tap to close'
      };
      var colorMap = {
        'idle': '#6b7280',
        'connecting': '#f59e0b',
        'listening': '#22c55e',
        'thinking': '#f59e0b',
        'speaking': '#3b82f6'
      };
      label.textContent = labelMap[state] || labelMap['idle'];
      label.style.color = colorMap[state] || colorMap['idle'];
    }
  }
  
  function handleMessage(event) {
    if (event.data && event.data.type === 'CLOSE_WIDGET') {
      var iframe = document.getElementById(iframeId);
      var launcher = document.getElementById(launcherId);
      var voiceOrb = document.getElementById(voiceOrbId);
      if (iframe && launcher) {
        iframe.style.display = 'none';
        launcher.style.display = 'flex';
        // Show voice orb again when widget closes
        if (voiceOrb) voiceOrb.style.display = 'flex';
      }
    }
    
    // Handle voice state changes from hidden voice iframe
    if (event.data && event.data.type === 'VOICE_STATE_CHANGE') {
      updateVoiceOrbAnimation(event.data.state);
    }
  }
  
  window.addEventListener('message', handleMessage);
  
  Promise.all([
    fetch(host + '/api/public/guidance-campaign-status/' + campaignId + '?businessAccountId=' + businessAccountId).then(function(r) { return r.ok ? r.json() : null; }),
    fetch(host + '/api/widget-settings/public?businessAccountId=' + businessAccountId).then(function(r) { return r.ok ? r.json() : null; })
  ]).then(function(results) {
    var campaignData = results[0];
    var widgetSettings = results[1];
    
    if (!campaignData || campaignData.isActive === false) return;
    
    var isFullScreen = campaignData.widgetSize === 'full';
    createIframe(isFullScreen);
    createLauncher(isFullScreen, widgetSettings);
    
    // Create voice orb on webpage if voice mode is enabled and position is not in-chat
    var voiceModeEnabled = campaignData.voiceModeEnabled === true || campaignData.voiceModeEnabled === 'true';
    var voiceModePosition = campaignData.voiceModePosition || 'in-chat';
    if (voiceModeEnabled && voiceModePosition !== 'in-chat') {
      createVoiceOrb(widgetSettings, voiceModePosition);
    }
  }).catch(function(err) {
    console.error('[Guidance Widget] Error:', err);
    createIframe(false);
    createLauncher(false, null);
  });
})();
