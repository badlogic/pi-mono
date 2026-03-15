import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const rootDir = process.cwd();
const tempDir = join(tmpdir(), `jensen-smoke-test-${Date.now()}`);

console.log('==> Starting Jensen Smoke Test');
console.log(`==> Root: ${rootDir}`);
console.log(`==> Temp: ${tempDir}`);

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, cwd = rootDir) {
	console.log(`> ${cmd} (in ${cwd})`);
	return execSync(cmd, { cwd, stdio: 'inherit' });
}

try {
	// 1. Clean and Build
	console.log('\n==> Step 1: Clean and Build everything');
	run(`${npmCmd} run clean`);
	run(`${npmCmd} run build`);

	// 2. Pack packages in order
	console.log('\n==> Step 2: Packing packages');
	const packages = ['ai', 'agent', 'tui', 'coding-agent'];
	const tarballs = {};

	for (const pkgDir of packages) {
		const pkgPath = join(rootDir, 'packages', pkgDir);
		const output = execSync(`${npmCmd} pack`, { cwd: pkgPath }).toString().trim();
		const filename = output.split('\n').pop().trim();
		tarballs[pkgDir] = join(pkgPath, filename);
		console.log(`  Packed ${pkgDir} -> ${filename}`);
	}

	// 3. Setup clean installation dir
	console.log('\n==> Step 3: Setup clean installation directory');
	if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	mkdirSync(tempDir);
	writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'smoke-test', type: 'module' }));

	// 4. Install tarballs
	console.log('\n==> Step 4: Installing tarballs');
	// We must install them together to resolve local dependencies correctly
	const tarballPaths = Object.values(tarballs).map(p => `"${p}"`).join(' ');
	run(`${npmCmd} install ${tarballPaths}`, tempDir);

	// 5. Verify the installation
	console.log('\n==> Step 5: Verifying the installation');
	const jensenBinName = process.platform === 'win32' ? 'jensen.cmd' : 'jensen';
	const jensenBin = join(tempDir, 'node_modules', '.bin', jensenBinName);
	
	if (!existsSync(jensenBin)) {
		throw new Error(`Jensen binary not found at ${jensenBin}`);
	}

	console.log('==> Checking jensen --version');
	run(`"${jensenBin}" --version`, tempDir);

	// 6. Check for stale imports in installed files
	console.log('\n==> Step 6: Checking for stale imports in installed node_modules');
	const installedAgentCore = join(tempDir, 'node_modules', '@apholdings', 'jensen-agent-core');
	const agentJs = join(installedAgentCore, 'dist', 'agent.js');
	
	if (!existsSync(agentJs)) {
		throw new Error(`agent.js not found at ${agentJs}`);
	}

	const findCmd = process.platform === 'win32' 
		? `findstr /s /i /c:"@mariozechner/pi-ai" "${tempDir}\\node_modules\\@apholdings\\*.js"`
		: `grep -r "@mariozechner/pi-ai" "${tempDir}/node_modules/@apholdings"`;
	console.log(`> ${findCmd}`);
	try {
		execSync(findCmd);
		throw new Error('Found stale import "@mariozechner/pi-ai" in installed files!');
	} catch (e) {
		// findstr returns exit code 1 if NOT found, which is what we want
		console.log('  SUCCESS: No stale imports found in installed files.');
	}

	console.log('\n✅ Jensen Smoke Test PASSED!');

} catch (error) {
	console.error('\n❌ Jensen Smoke Test FAILED!');
	console.error(error.message);
	process.exit(1);
} finally {
	// Cleanup
	console.log('\n==> Cleanup');
	// Delete tarballs
	for (const pkgDir of ['ai', 'agent', 'tui', 'coding-agent']) {
		const pkgPath = join(rootDir, 'packages', pkgDir);
		const files = execSync('dir /b *.tgz', { cwd: pkgPath }).toString().trim().split('\n');
		for (const f of files) {
			if (f.trim()) rmSync(join(pkgPath, f.trim()));
		}
	}
	// Cleanup temp dir
	// rmSync(tempDir, { recursive: true, force: true });
}
