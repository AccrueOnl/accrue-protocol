import './styles.css';
import { initSlots } from './lib/slots.js';
import { initMotion } from './lib/motion.js';
import { initDither } from './lib/dither.js';
import { initLive } from './lib/live.js';

initSlots();
initMotion();
initDither(document.getElementById('dither'));
initLive();
