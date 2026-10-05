# SINGULAR UI expansion report

## Logo integration

The supplied 2172×724 transparent PNG is used without redrawing, cropping or distortion in the homepage, footer, Whitepaper, Docs, App navigation and App loading sequence. A symbol-only favicon was not created because no official symbol-only asset was provided.

## New routes

- `/whitepaper/` — interactive editorial whitepaper with 20 anchored chapters.
- `/docs/` — technical documentation shell with navigation, search modal and code blocks.
- `/app/` — dedicated pool environment.
- `/app/pool.html?id=…` — static prototype of the pool-detail route.
- `/app/entries.html`, `/app/results.html`, `/app/result.html`, `/app/refunds.html`.

These are static preview routes. A production framework may map pool and result pages to `/app/pool/:id` and `/app/result/:id`.

## Whitepaper

The Whitepaper uses the existing cosmic palette and typography while adopting an editorial reading width, sticky chapter rail, reading progress, data cards, risk callouts and protocol diagrams. It avoids fake deployments, audits, token mechanics and contract addresses.

## Technical Docs

Docs separates protocol concepts, contract interfaces, developer integration and security assumptions. It includes desktop navigation, mobile-collapsible layout, Ctrl/Cmd+K or `/` search modal, copyable restrained code blocks and an on-page outline.

## App redesign

The App is now a distinct product environment with a restrained cosmic field, premium dashboard metrics, event-horizon progress rings, branded pool states, pool detail, probability transitions, entries, results, verification and refunds. All write actions remain disabled or explicitly demo-only.

## Motion system

- 1.2–1.8 second logo convergence loader.
- Slow event-horizon pulse and progress rings.
- Short card elevation and probability interpolation.
- Reading progress and subtle cosmic depth.
- Reduced-motion rules collapse animation to static/near-instant transitions.

## Responsive behavior

Editorial rails collapse on smaller screens; Docs becomes single-column; App metrics and pool cards reflow; the pool visual remains above the entry panel. Touch targets remain large and mouse-only behavior is omitted on mobile.

## Performance

Pages are split into separate static documents so the marketing homepage does not load App or Docs behavior. Motion uses transforms, opacity and CSS gradients. No WebGL dependency or Web3 bundle is loaded. The supplied PNG is currently the largest local asset and should receive an optimized WebP/AVIF derivative only with approval to transform the official asset.

## Web3 integration status

The experience is `BSC TEST MODE`. Wallet prompts and entry buttons do not send transactions. Production integration still requires environment-driven RPC configuration, verified deployments, ABI publication, wallet state management, chain switching, resilient reads and an event indexer.

## Remaining contract work

Install Foundry, resolve dependencies, compile and run unit/fuzz/invariant tests; expand adversarial tests; deploy to BSC testnet; complete an independent audit and remediation; transfer privileged ownership to an appropriate multisig/timelock; then verify bytecode and sources.

## Remaining Flap work

No token address, liquidity, buyback, burn or creator-fee system is claimed. Update the Token material only after the final onchain configuration is deployed and publicly verifiable.

## Remaining randomness work

Select and integrate a verifiable BSC randomness provider, test callback/funding/failure behavior, document its assumptions and monitor requests before enabling production pools.
