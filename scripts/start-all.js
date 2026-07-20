import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apps = [
  { name: 'Hub (5173)', dir: rootDir },
  { name: 'Tạo Card (5174)', dir: path.join(rootDir, 'tao-card') },
  { name: 'Tạo Preset (5175)', dir: path.join(rootDir, 'preset-tool') },
  { name: 'Mod Card (5176)', dir: path.join(rootDir, 'mod-card') },
  { name: 'Crawler (5177)', dir: path.join(rootDir, 'crawler') }
];

const children = [];

function cleanup(reason) {
  console.log(`\n[Launcher] Stopping all servers... (Reason: ${reason})`);
  for (const child of children) {
    if (child && !child.killed) {
      try {
        // On Windows, kill process tree if started with shell: true
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${child.pid} /t /f`, { stdio: 'ignore' });
        } else {
          child.kill('SIGTERM');
        }
      } catch (err) {
        // ignore errors on killing already dead processes
      }
    }
  }
  process.exit();
}

// Register cleanup events
process.on('SIGINT', () => cleanup('SIGINT'));
process.on('SIGTERM', () => cleanup('SIGTERM'));
process.on('SIGHUP', () => cleanup('SIGHUP'));
process.on('exit', () => cleanup('exit'));

// Free ports first using powershell scripts/free-ports.ps1
try {
  console.log('[Launcher] Freeing ports...');
  const freePortsScript = path.join(rootDir, 'scripts', 'free-ports.ps1');
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${freePortsScript}" 5173 5174 5175 5176 5177`, { stdio: 'inherit' });
} catch (e) {
  console.error('[Launcher] Warning: failed to free ports automatically.');
}

console.log('[Launcher] Starting all servers concurrently in this terminal...');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

apps.forEach(app => {
  // npm install truoc moi lan chay (giong start.bat cu): sau update git co the co dep MOI,
  // thieu la dev server chet voi "Failed to resolve import". Da co node_modules thi chi ton vai giay.
  const child = spawn(`${npmCmd} install --no-audit --no-fund && ${npmCmd} run dev`, {
    cwd: app.dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });
  
  children.push(child);
  
  child.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.log(`[${app.name}] ${line}`);
    });
  });
  
  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) console.error(`[${app.name}] ERROR: ${line}`);
    });
  });
  
  child.on('close', (code) => {
    console.log(`[${app.name}] Process exited with code ${code}`);
  });
});
