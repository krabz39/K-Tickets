
/* K-Tickets progressive enhancement only. Does not call APIs or alter payment flows. */
(function(){
  'use strict';
  var deferredPrompt=null;
  var isStandalone=window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true;
  function makeInstallNotice(message,actionLabel,onAction){
    if(document.getElementById('kt-install-notice')) return;
    var wrap=document.createElement('aside');
    wrap.id='kt-install-notice';
    wrap.setAttribute('role','status');
    wrap.style.cssText='position:fixed;z-index:100000;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));max-width:520px;margin:auto;padding:15px 16px;border-radius:18px;background:#470d15;color:#fff8f0;box-shadow:0 18px 55px rgba(0,0,0,.28);display:flex;align-items:center;gap:12px;font:14px/1.45 system-ui,sans-serif';
    var copy=document.createElement('div');copy.style.flex='1';copy.textContent=message;
    var action=document.createElement('button');action.type='button';action.textContent=actionLabel;
    action.style.cssText='border:0;border-radius:11px;background:#F5DABF;color:#470d15;font-weight:800;padding:10px 13px;white-space:nowrap';
    action.addEventListener('click',function(){onAction();wrap.remove();});
    var close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Dismiss');close.textContent='×';
    close.style.cssText='border:0;background:transparent;color:#fff;font-size:23px;padding:0 3px';
    close.addEventListener('click',function(){wrap.remove();});
    wrap.append(copy,action,close);document.body.appendChild(wrap);
  }
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();deferredPrompt=e;
    if(!isStandalone) makeInstallNotice('Install K-Tickets for quicker access to events and your tickets.','Install',function(){
      if(!deferredPrompt)return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function(){deferredPrompt=null;});
    });
  });
  window.addEventListener('appinstalled',function(){deferredPrompt=null;var n=document.getElementById('kt-install-notice');if(n)n.remove();});
  var ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(ios&&!isStandalone){
    window.addEventListener('load',function(){
      if(!sessionStorage.getItem('kt-install-tip-seen')){
        makeInstallNotice('Add K-Tickets to your Home Screen: tap Share, then “Add to Home Screen”.','Got it',function(){sessionStorage.setItem('kt-install-tip-seen','1');});
      }
    });
  }
})();
