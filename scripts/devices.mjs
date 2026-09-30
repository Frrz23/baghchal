import { KnownDevices } from 'puppeteer-core';

const chromeUA = (device) =>
  `Mozilla/5.0 (Linux; Android 15; ${device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36`;

const profile = (name, device, width, height, dpr) => ({
  name,
  userAgent: chromeUA(device),
  viewport: { width, height, deviceScaleFactor: dpr, isMobile: true, hasTouch: true },
});

export const CUSTOM_DEVICES = {
  'Samsung A56': profile('Samsung A56', 'SM-A566B', 393, 851, 2.75),
  'Samsung A15': profile('Samsung A15', 'SM-A155F', 360, 800, 2),
  'Redmi Note 13': profile('Redmi Note 13', '2312DRA50G', 393, 873, 2.75),
};

export function listDevices() {
  const builtins = Object.keys(KnownDevices).filter((n) => !n.endsWith(' landscape'));
  return { custom: Object.keys(CUSTOM_DEVICES), builtins };
}

export function resolveDevice(name) {
  const device = CUSTOM_DEVICES[name] ?? KnownDevices[name];
  if (!device) {
    throw new Error(`Unknown device "${name}". Run: npm run responsive -- --devices list`);
  }
  return device;
}

export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function printDeviceList() {
  const { custom, builtins } = listDevices();
  console.log('Custom devices:');
  for (const n of custom) console.log(`  ${n}`);
  console.log('\nBuilt-in devices (append " landscape" for landscape mode):');
  for (const n of builtins) console.log(`  ${n}`);
  console.log('\nExamples:');
  console.log('  npm run responsive -- --devices "Samsung A56,iPhone 14,Galaxy S9+"');
}
