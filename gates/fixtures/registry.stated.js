/* Synthetic register used only by gate builds: every external record is "stated" with fake values. */
import { register as base } from '../../src/registry.js';

export const register = {
  ...base,
  ca: { ...base.ca, state: 'stated', value: '0xA1b2C3d4E5f60718293a4B5c6D7e8F9012345678' },
  x: { ...base.x, state: 'stated', value: 'https://x.com/fixture_handle' },
  github: { ...base.github, state: 'stated', value: 'https://github.com/fixture-org' },
};
