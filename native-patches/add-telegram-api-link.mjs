import fs from 'node:fs';

const target = process.argv[2] || 'web/src/main.js';
const source = fs.readFileSync(target, 'utf8');

if (source.includes('api-credentials-link')) {
  console.log('Telegram API credentials link is already prominent.');
  process.exit(0);
}

const oldBlock = '<div class="auth-footnote">Get your own API ID and hash from <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org</a>. CloudVault does not use bot tokens or a file-storage server.</div>';
const newBlock = '<a class="secondary-button api-credentials-link" href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer" aria-label="Open official Telegram API settings to get an API ID and API hash" style="width:100%;min-height:44px;padding:12px 16px;margin:7px 0 2px;text-decoration:none;background:#1b3045;border:1px solid #3d6783;color:#c5f1ff">Get Telegram API ID &amp; API Hash ↗</a><div class="auth-footnote">Opens Telegram’s official API settings. Create your API ID and API hash there, then return to CloudVault. CloudVault never asks for your Telegram password on that site.</div>';

if (!source.includes(oldBlock)) {
  throw new Error(`Could not find the expected Telegram API help link in ${target}; refusing to patch an unknown UI.`);
}

fs.writeFileSync(target, source.replace(oldBlock, newBlock));
console.log(`Added the official Telegram API settings link to ${target}`);
