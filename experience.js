document.addEventListener('DOMContentLoaded',()=>{const bar=document.querySelector('.progress');if(bar)addEventListener('scroll',()=>{const d=document.documentElement;bar.style.width=`${d.scrollTop/(d.scrollHeight-d.clientHeight)*100}%`});document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.closest('.code').querySelector('code').innerText);b.textContent='Copied'});const sm=document.querySelector('.search-modal');document.querySelectorAll('[data-search]').forEach(b=>b.onclick=()=>{sm?.classList.add('open');sm?.querySelector('input')?.focus()});sm?.addEventListener('click',e=>{if(e.target===sm)sm.classList.remove('open')});addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'||e.key==='/'){if(!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();sm?.classList.add('open');sm?.querySelector('input')?.focus()}}if(e.key==='Escape')sm?.classList.remove('open')});});

document.addEventListener('DOMContentLoaded', () => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: .08, rootMargin: '0px 0px 60px 0px' });
  document.querySelectorAll('main > section:not(.hero):not(.reading), .paper article, .docs-main > section').forEach(element => {
    element.classList.add('reveal'); observer.observe(element);
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('#drawSequence');
  if (!panel) return;
  const tickets = panel.querySelector('#drawSequenceTickets');
  tickets.replaceChildren(...Array.from({ length: 11 }, () => document.createElement('i')));
  const cells = [...tickets.children];
  const status = panel.querySelector('#drawSequenceStatus');
  const count = panel.querySelector('#drawSequenceCount');
  const note = panel.querySelector('#drawSequenceNote');
  const progress = panel.querySelector('#drawSequenceProgress');
  const phases = [
    { sold: 1, status: 'POOL LIVE', note: 'The first confirmed ticket starts the countdown.' },
    { sold: 4, status: 'MORE ENTRIES', note: 'Every purchase adds numbered tickets to the pool.' },
    { sold: 8, status: 'POOL FILLING', note: 'Eight tickets recorded; three places remain.' },
    { sold: 11, status: 'SOLD OUT', note: 'All 11 tickets are sold. Entries close immediately.' },
    { sold: 11, status: 'VRF DRAW', note: 'A randomness request selects one of the recorded tickets.' },
    { sold: 11, status: 'ONE WINNER', note: 'Illustration: ticket #08 wins the 0.1 BNB prize.' }
  ];
  let phase = 0, timer;
  function show(index) {
    phase = index;
    const item = phases[index];
    status.textContent = item.status;
    count.textContent = `${String(item.sold).padStart(2, '0')} / 11 TICKETS`;
    note.textContent = item.note;
    progress.style.width = `${item.sold / 11 * 100}%`;
    cells.forEach((cell, ticket) => {
      cell.classList.toggle('is-filled', ticket < item.sold);
      cell.classList.toggle('is-drawing', index === 4 && ticket < item.sold);
      cell.classList.toggle('is-winner', index === 5 && ticket === 7);
    });
  }
  function stop() { clearInterval(timer); timer = undefined; }
  function start() { if (timer || document.hidden) return; timer = setInterval(() => show((phase + 1) % phases.length), 1500); }
  show(0);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { if (entries[0].isIntersecting) start(); else stop(); }, { threshold: .15 }).observe(panel);
  else start();
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
});

document.addEventListener('DOMContentLoaded', () => {
  const panel = document.querySelector('.refund-demo__panel');
  if (!panel) return;
  const phases = [
    { sold: 3, time: '06:20', status: 'LIVE POOL', note: 'Contributions remain recorded while the pool is live.' },
    { sold: 5, time: '03:40', status: 'LIVE POOL', note: 'More tickets have been purchased; six remain.' },
    { sold: 7, time: '00:48', status: 'LIVE POOL', note: 'The pool is not full. The deadline is approaching.' },
    { sold: 7, time: '00:00', status: 'POOL EXPIRED', note: 'No winner is selected and no protocol fee is collected.' },
    { sold: 7, time: '00:00', status: 'REFUND AVAILABLE', note: 'Buyer A, B and C can each claim their own BNB contribution.' }
  ];
  let step = 0, timer;
  function show() {
    const phase = phases[step];
    panel.querySelector('#refundDemoStatus').textContent = phase.status;
    panel.querySelector('#refundDemoSold').textContent = `${phase.sold} / 11`;
    panel.querySelector('#refundDemoTime').textContent = phase.time;
    panel.querySelector('#refundDemoBar').style.width = `${phase.sold / 11 * 100}%`;
    panel.querySelector('#refundDemoRemaining').textContent = `${11 - phase.sold} tickets unsold`;
    panel.querySelector('#refundDemoClaim').textContent = step === 4 ? 'REFUNDS CLAIMABLE' : 'DRAW NOT EXECUTED';
    panel.querySelector('#refundDemoNote').textContent = phase.note;
    panel.classList.toggle('is-refundable', step === 4);
    panel.querySelectorAll('.refund-demo__buyers > div').forEach((buyer, index) => {
      buyer.classList.toggle('is-pending', index === 1 && phase.sold < 5 || index === 2 && phase.sold < 7);
    });
    step = (step + 1) % phases.length;
  }
  show();
  if (!('IntersectionObserver' in window)) { timer = setInterval(show, 1800); return; }
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !timer) timer = setInterval(show, 1800);
    if (!entries[0].isIntersecting && timer) { clearInterval(timer); timer = undefined; }
  }, { threshold: .15 });
  observer.observe(panel);
});

// Add a soft reveal and pointer-following light to informational surfaces.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const selector = '.rule-grid article,.proof-teaser__facts>div,.join-steps__list article,.live-preview article,.app-body .pool-card,.app-body .demo-card,.app-body .entry-panel';
  const seen = new WeakSet();
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('motion-enter');
      observer.unobserve(entry.target);
    }
  }, { threshold: .08, rootMargin: '0px 0px 32px 0px' }) : null;
  function register(root) {
    const elements = root.matches?.(selector) ? [root] : [...root.querySelectorAll(selector)];
    for (const [index, element] of elements.entries()) {
      if (seen.has(element)) continue;
      seen.add(element);
      element.classList.add('motion-surface');
      element.style.setProperty('--motion-delay', `${Math.min(index % 5, 4) * 65}ms`);
      observer?.observe(element);
    }
  }
  function start() {
    register(document.body);
    const root = document.querySelector('#appRoot');
    if (root) new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1) register(node);
      }
    }).observe(root, { childList: true, subtree: true });
    document.addEventListener('pointermove', event => {
      const card = event.target.closest?.('.motion-surface');
      if (!card) return;
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
      card.style.setProperty('--my', `${event.clientY - bounds.top}px`);
    }, { passive: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
