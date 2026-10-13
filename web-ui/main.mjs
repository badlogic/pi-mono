import { spawn } from 'node:child_process';
import { openDurable } from '../packages/coding-agent/src/experimental/durable/runtime.ts';
import { startServer } from './server.mjs';

let durable;
let web;
try {
  const options = { port: 4317, open: true, cwd: process.cwd(), continueSession: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--continue' || arg === '-c') options.continueSession = true;
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--cwd' && args[i + 1]) options.cwd = args[++i];
    else if (arg === '--port' && /^\d+$/.test(args[i + 1] || '')) options.port = Number(args[++i]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (options.port > 65535) throw new Error('Port must be between 0 and 65535.');
  durable = await openDurable({ cwd: options.cwd, continueSession: options.continueSession });
  web = await startServer(durable, { port: options.port });
  console.log(`Pi durable web · ${durable.view.current().session.cwd}\n${web.url}\nCtrl+C stops the server. Use --continue to resume this session.`);
  if (options.open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', web.url] : [web.url];
    const browser = spawn(command, args, { stdio: 'ignore', detached: true });
    browser.on('error', error => console.error(`Could not open browser: ${error.message}. Open the URL above.`));
    browser.on('exit', code => { if (code) console.error('Browser opener failed. Open the URL above.'); });
    browser.unref();
  }
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    try { await web.close(); await durable.close(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { clearTimeout(timeout); }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (error) {
  console.error(`Unable to start Pi durable web: ${error.message}`);
  await web?.close();
  await durable?.close();
  process.exitCode = 1;
}
