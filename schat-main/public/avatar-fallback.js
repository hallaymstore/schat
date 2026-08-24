(function(){
  'use strict';
  const DEFAULT_PATTERN = /(?:res\.cloudinary\.com\/demo\/.*default-avatar|\/default-avatar\.(?:png|jpg|jpeg|webp)|^\s*$)/i;

  function safeValue(value){ return String(value || '').trim().toLowerCase().replace(/[^a-z_]/g, ''); }
  function objectId(value){
    const match = String(value || '').match(/[a-f0-9]{24}/i);
    return match ? match[0] : '';
  }
  function avatarUserId(img){
    const direct = objectId(img.dataset.avatarUser || img.dataset.userId || '');
    if(direct) return direct;
    const owner = img.closest('[data-uid],[data-user-id],[data-member-id],[data-id]');
    const fromOwner = objectId(owner?.dataset?.uid || owner?.dataset?.userId || owner?.dataset?.memberId || owner?.dataset?.id || '');
    if(fromOwner) return fromOwner;
    return objectId(img.getAttribute('onclick') || img.closest('[onclick]')?.getAttribute('onclick') || '');
  }
  function inferredRole(img){
    const direct = safeValue(img.dataset.avatarRole || img.closest('[data-role]')?.dataset?.role || '');
    if(direct) return direct;
    const copy = String(img.closest('article,li,.member,.message,[class*="member"],[class*="user"]')?.textContent || '').toLowerCase();
    return /o['‘’]?qituvchi|teacher|admin|dekan|rektor/.test(copy) ? 'teacher' : 'student';
  }
  function fallbackUrl(img){
    const id = avatarUserId(img) || 'anonymous';
    const params = new URLSearchParams();
    const role = inferredRole(img);
    const gender = safeValue(img.dataset.avatarGender || img.closest('[data-gender]')?.dataset?.gender || '');
    if(role) params.set('role', role);
    if(gender) params.set('gender', gender);
    return `/api/avatar-placeholder/${id}.svg?${params.toString()}`;
  }
  function applyFallback(img){
    if(!(img instanceof HTMLImageElement) || img.dataset.avatarFallbackApplied === '1') return;
    img.dataset.avatarFallbackApplied = '1';
    img.src = fallbackUrl(img);
    if(!img.alt) img.alt = 'Profil ikoni';
  }
  function bind(img){
    if(!(img instanceof HTMLImageElement) || img.dataset.avatarFallbackBound === '1') return;
    img.dataset.avatarFallbackBound = '1';
    img.addEventListener('error', ()=>applyFallback(img));
    const source = String(img.getAttribute('src') || '');
    if(DEFAULT_PATTERN.test(source)) applyFallback(img);
  }
  function scan(root){
    if(root instanceof HTMLImageElement) bind(root);
    root.querySelectorAll?.('img').forEach(bind);
  }
  function init(){
    scan(document);
    const observer = new MutationObserver((records)=>records.forEach((record)=>record.addedNodes.forEach((node)=>{
      if(node instanceof Element) scan(node);
    })));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
