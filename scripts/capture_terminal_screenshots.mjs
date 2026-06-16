import { execSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const puppeteer = require('/Users/edycu/Projects/DemoStudio/node_modules/puppeteer');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'docs', 'screenshots');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Convert ANSI escape codes to HTML
function ansiToHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Reset
  html = html.replace(/\x1b\[0m/g, '</span>');
  
  const colors = {
    '1;32': '#22c55e',
    '32': '#22c55e',
    '1;31': '#ef4444',
    '31': '#ef4444',
    '1;36': '#06b6d4',
    '36': '#06b6d4',
    '1;34': '#3b82f6',
    '34': '#3b82f6',
    '1;35': '#a855f7',
    '35': '#a855f7',
    '1;33': '#eab308',
    '33': '#eab308',
    '1;30': '#64748b',
    '30': '#64748b',
    '90': '#64748b',
  };

  for (const [code, color] of Object.entries(colors)) {
    const rx = new RegExp(`\\x1b\\[${code}m`, 'g');
    html = html.replace(rx, `<span style="color: ${color}">`);
  }

  // Remove leftover escape sequences
  html = html.replace(/\x1b\[[0-9;]*m/g, '');
  return html;
}

function makeHtml(header, command, content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
    body {
      background-color: #0b0f19;
      color: #f8fafc;
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      line-height: 1.5;
      padding: 0;
      margin: 0;
    }
    .terminal-window {
      background-color: #0b0f19;
      overflow: hidden;
      display: inline-block;
      width: 100vw;
      height: 100vh;
      box-sizing: border-box;
    }
    .terminal-header {
      background-color: #131a27;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      border-bottom: 1px solid #1e293b;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 8px;
    }
    .dot.red { background-color: #ef4444; }
    .dot.yellow { background-color: #eab308; }
    .dot.green { background-color: #22c55e; }
    .terminal-title {
      color: #64748b;
      font-size: 13px;
      margin-left: 20px;
    }
    .terminal-body {
      padding: 24px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .beat-header {
      color: #3b82f6;
      font-weight: bold;
      margin-bottom: 12px;
    }
    .command {
      color: #22c55e;
      font-weight: bold;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="terminal-window">
    <div class="terminal-header">
      <div class="dot red"></div>
      <div class="dot yellow"></div>
      <div class="dot green"></div>
      <div class="terminal-title">bash — payguard</div>
    </div>
    <div class="terminal-body">
      <div class="beat-header">${header}</div>
      <div class="command">$ ${command}</div>
      <div>${content}</div>
    </div>
  </div>
</body>
</html>
  `;
}

async function capture(header, command, output, filename, viewport = { width: 1000, height: 600 }) {
  const htmlContent = makeHtml(header, command, ansiToHtml(output));
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  
  const dest = join(OUTPUT_DIR, filename);
  await page.screenshot({ path: dest, fullPage: false });
  await browser.close();
  
  console.log(`✅ Saved screenshot: ${dest}`);
}

function runSync(command) {
  try {
    return execSync(command, {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1'
      }
    }).toString();
  } catch (err) {
    return err.stdout ? err.stdout.toString() : err.message;
  }
}

function runServerAndCaptureOutput(timeoutMs = 4000) {
  return new Promise((resolve) => {
    console.log('🏃 Starting npm run server for Beat 4 capture...');
    const p = spawn('npm', ['run', 'server'], {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1'
      }
    });

    let output = '';
    
    p.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      if (chunk.includes('PayGuard server on')) {
        setTimeout(() => {
          p.kill();
        }, 500);
      }
    });

    p.stderr.on('data', (data) => {
      output += data.toString();
    });

    const timer = setTimeout(() => {
      p.kill();
    }, timeoutMs);

    p.on('close', () => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

function runDemoWithServer() {
  return new Promise((resolve, reject) => {
    console.log('🏃 Starting npm run server in background for Beat 5 demo...');
    const server = spawn('npm', ['run', 'server'], {
      cwd: ROOT,
      env: {
        ...process.env,
        FORCE_COLOR: '1',
        CLICOLOR_FORCE: '1'
      }
    });

    let serverReady = false;
    let demoOutput = '';

    const runDemo = () => {
      console.log('🏃 Running npm run demo...');
      try {
        demoOutput = execSync('npm run demo', {
          cwd: ROOT,
          env: {
            ...process.env,
            FORCE_COLOR: '1',
            CLICOLOR_FORCE: '1'
          }
        }).toString();
      } catch (err) {
        demoOutput = err.stdout ? err.stdout.toString() : err.message;
      } finally {
        server.kill();
      }
    };

    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      if (!serverReady && chunk.includes('PayGuard server on')) {
        serverReady = true;
        setTimeout(runDemo, 1000);
      }
    });

    server.on('close', () => {
      resolve(demoOutput);
    });

    setTimeout(() => {
      if (!serverReady) {
        server.kill();
        reject(new Error('Timeout waiting for server to start for Beat 5'));
      }
    }, 10000);
  });
}

async function main() {
  console.log('📸 Generating terminal screenshots for DoraHacks submission...');
  
  // Make sure port is free first
  try {
    execSync('npx kill-port 4021', { stdio: 'ignore' });
  } catch (_) {}

  // 1. Beat 1: Malicious Vector Benchmarks
  const out1 = runSync('npm run bench');
  await capture(
    '--- Beat 1: Running GuardianRail Malicious Vector Benchmarks ---',
    'npm run bench',
    out1,
    'payguard-beat-1.png',
    { width: 1000, height: 480 }
  );

  // 2. Beat 2: Smart Contract Tests
  const out2 = runSync('forge test');
  await capture(
    '--- Beat 2: Running AgentVault Solidity Contract Suite ---',
    'forge test',
    out2,
    'payguard-beat-2.png',
    { width: 1000, height: 520 }
  );

  // 3. Beat 3: Autonomous Agent Run
  const envKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY; // run offline planner
  const out3 = runSync('npm run agent');
  if (envKey) process.env.ANTHROPIC_API_KEY = envKey; // restore
  
  await capture(
    '--- Beat 3: Running Autonomous Agent under GuardianRail ---',
    'npm run agent',
    out3,
    'payguard-beat-3.png',
    { width: 1000, height: 600 }
  );

  // 4. Beat 4: Start local x402 server
  try {
    execSync('npx kill-port 4021', { stdio: 'ignore' });
  } catch (_) {}
  const out4 = await runServerAndCaptureOutput();
  await capture(
    '--- Beat 4: Initializing local x402 resource server ---',
    'npm run server',
    out4,
    'payguard-beat-4.png',
    { width: 1000, height: 200 }
  );

  // 5. Beat 5: E2E demo
  try {
    execSync('npx kill-port 4021', { stdio: 'ignore' });
  } catch (_) {}
  const out5 = await runDemoWithServer();
  await capture(
    '--- Beat 5: Running Guarded E2E Payment Settlement ---',
    'npm run demo',
    out5,
    'payguard-beat-5.png',
    { width: 1000, height: 300 }
  );

  // 6. Beat 6: cast receipt
  const txHash = '0xfd6e66157765066d9ff76068ee9476549153ade951036f3f7863a29f2ffbc253';
  const rpcUrl = 'https://atlantic.dplabs-internal.com/';
  const castCmd = `cast receipt ${txHash} --rpc-url ${rpcUrl} | grep -E "status|blockNumber"`;
  const out6 = runSync(castCmd);
  await capture(
    '--- Beat 6: Verifying EIP-3009 Settlement on Pharos Atlantic ---',
    castCmd,
    out6,
    'payguard-beat-6.png',
    { width: 1000, height: 260 }
  );

  console.log('🎉 Done generating screenshots!');
}

main().catch(console.error);
