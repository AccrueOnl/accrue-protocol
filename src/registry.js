/*
  REGISTER — one record per external fact.
  state: "stated"      the owner confirmed it; safe to render and link
         "absent"      does not exist yet; render an inert slot, never an href
         "unconfirmed" seen but not verified; render nothing that depends on it

  Links store a URL only. The visible handle is always derived from it (see handleOf).
  Flip a record by editing `state` and `value` here; nothing else needs to change.
*/
export const STATES = ['stated', 'absent', 'unconfirmed'];

export const register = {
  domain: { label: 'Site domain', state: 'stated', value: 'accrue.onl' },

  chainName: { label: 'Chain name', state: 'stated', value: 'Robinhood Chain' },
  chainId: { label: 'Chain id', state: 'stated', value: 4663 },
  rpc: { label: 'Public RPC', state: 'stated', value: 'https://rpc.mainnet.chain.robinhood.com' },

  llamaChain: { label: 'DefiLlama chain key', state: 'stated', value: 'Robinhood Chain' },
  dexChain: { label: 'DexScreener chain slug', state: 'stated', value: 'robinhood' },
  llamaUrl: { label: 'DefiLlama', state: 'stated', value: 'https://defillama.com/chain/Robinhood%20Chain' },
  dexUrl: { label: 'DexScreener', state: 'stated', value: 'https://dexscreener.com/robinhood' },

  ca: { label: 'Contract address', state: 'absent', value: null },
  x: { label: 'X', state: 'absent', value: null, note: 'owner-supplied handle: @Accrue_Onl; URL not yet confirmed' },
  github: { label: 'GitHub', state: 'absent', value: null },

  launch: { label: 'Launch date', state: 'absent', value: null },
  brandAssets: { label: 'Brand assets', state: 'stated', value: 'brand/', note: 'palette sampled from brand/ and reference/; see tools/palette.sampled.json' },
  ogImage: { label: 'Social preview image', state: 'stated', value: '/og.jpg' },
};
