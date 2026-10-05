// Homepage editorial copy uses clean, punctuation-free display text.
// Numeric decimals, wallet identifiers and ticket fractions remain untouched.
document.addEventListener('DOMContentLoaded', () => {
  const skip = node => node.parentElement?.closest('script,style,code,pre,.winner-address,.purchase-ribbon__track,.draw-sequence__state,.draw-sequence__terms,.draw-sequence__tickets,.live-metrics,.pool-card,.refund-demo__panel,.odds-story__bars');
  const clean = value => value
    .replace(/\.(?!\d)|(?<!\d)\./g, '')
    .replace(/[!?;,:·↗→↓↑…©]/g, ' ')
    .replace(/\s[\/=&]\s/g, ' ')
    .replace(/\s[-–—]\s/g, ' ')
    .replace(/\s{2,}/g, ' ');
  function visit(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (skip(node) || !node.nodeValue.trim()) continue;
      const next = clean(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  }
  visit(document.body);
  new MutationObserver(changes => {
    for (const change of changes) {
      if (change.type === 'characterData') visit(change.target.parentElement || document.body);
      else for (const node of change.addedNodes) if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) visit(node);
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true });
});
