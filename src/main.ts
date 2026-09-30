import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';
import './style.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
new App(root);
