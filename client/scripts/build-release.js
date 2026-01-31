#!/usr/bin/env node

/**
 * MineMaster Release Build Script
 * 
 * Builds distributable packages for Linux and Windows:
 * - Linux: AppImage (single portable file)
 * - Windows: Portable .exe (single file) + NSIS Installer
 * 
 * Usage:
 *   node scripts/build-release.js [options]
 * 
 * Options:
 *   --linux     Build Linux AppImage only
 *   --windows   Build Windows portable + installer only
 *   --all       Build for all platforms (default)
 *   --portable  Build only portable versions (AppImage + portable .exe)
 *   --clean     Clean dist folder before building
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const MINERS_DIR = path.join(ROOT_DIR, 'miners');

// Parse command line arguments
const args = process.argv.slice(2);
const buildLinux = args.includes('--linux') || args.includes('--all') || args.length === 0;
const buildWindows = args.includes('--windows') || args.includes('--all') || args.length === 0;
const portableOnly = args.includes('--portable');
const cleanFirst = args.includes('--clean');

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  MineMaster Release Builder');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// Helper to run commands
function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  try {
    execSync(cmd, { 
      stdio: 'inherit', 
      cwd: ROOT_DIR,
      ...options 
    });
    return true;
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    return false;
  }
}

// Helper to check if a command exists
function commandExists(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>nul`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Clean dist directory
function cleanDist() {
  console.log('🧹 Cleaning dist directory...');
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  console.log('');
}

// Download miners for a specific platform
async function downloadMinersForPlatform(platform) {
  console.log(`📥 Ensuring miners are downloaded for ${platform}...`);
  
  const { downloadMiner, MINERS } = require('./download-miners.js');
  
  for (const [minerName, minerConfig] of Object.entries(MINERS)) {
    const config = minerConfig[platform];
    if (!config) {
      console.log(`   ⚠️  No ${minerName} available for ${platform}`);
      continue;
    }
    
    const minerDir = path.join(MINERS_DIR, minerName);
    const binaryPath = path.join(minerDir, config.binary);
    
    if (fs.existsSync(binaryPath)) {
      console.log(`   ✓ ${minerName} already exists`);
    } else {
      console.log(`   📥 Downloading ${minerName} for ${platform}...`);
      try {
        await downloadMiner(minerName, minerConfig);
      } catch (error) {
        console.error(`   ❌ Failed to download ${minerName}: ${error.message}`);
      }
    }
  }
  console.log('');
}

// Build React app
function buildReact() {
  console.log('🔨 Building React application...');
  console.log('');
  
  if (!run('npm run build')) {
    console.error('❌ React build failed!');
    process.exit(1);
  }
  console.log('');
}

// Build for Linux
function buildForLinux() {
  console.log('🐧 Building for Linux...');
  console.log('');
  
  const cmd = 'npx electron-builder --linux AppImage';
  
  if (!run(cmd)) {
    console.error('❌ Linux build failed!');
    return false;
  }
  
  console.log('');
  return true;
}

// Check if wine32 is properly installed
function checkWine32() {
  try {
    // Check if wine can actually run 32-bit executables
    execSync('wine --version 2>/dev/null', { stdio: 'ignore' });
    // Try to check for wine32 specifically
    const result = execSync('dpkg -l wine32 2>/dev/null || dpkg -l wine32:i386 2>/dev/null || true', { encoding: 'utf8' });
    return result.includes('wine32');
  } catch {
    return false;
  }
}

// Build for Windows
function buildForWindows() {
  console.log('🪟 Building for Windows...');
  console.log('');
  
  // Check if we can cross-compile (need wine + wine32 on Linux)
  const isLinux = process.platform === 'linux';
  if (isLinux) {
    if (!commandExists('wine')) {
      console.log('⚠️  Wine not found. Cross-compiling Windows builds requires wine.');
      console.log('');
      console.log('   Install with:');
      console.log('     sudo dpkg --add-architecture i386');
      console.log('     sudo apt update');
      console.log('     sudo apt install wine wine32:i386');
      console.log('');
      console.log('   Skipping Windows build...');
      console.log('');
      return null; // null = skipped, not failed
    }
    
    if (!checkWine32()) {
      console.log('⚠️  wine32 (32-bit support) not found.');
      console.log('');
      console.log('   Install with:');
      console.log('     sudo dpkg --add-architecture i386');
      console.log('     sudo apt update');
      console.log('     sudo apt install wine32:i386');
      console.log('');
      console.log('   Skipping Windows build...');
      console.log('');
      return null; // null = skipped, not failed
    }
  }
  
  let cmd;
  if (portableOnly) {
    cmd = 'npx electron-builder --windows portable';
  } else {
    cmd = 'npx electron-builder --windows portable nsis';
  }
  
  if (!run(cmd)) {
    console.error('❌ Windows build failed!');
    return false;
  }
  
  console.log('');
  return true;
}

// Main build process
async function main() {
  const startTime = Date.now();
  
  // Show build configuration
  console.log('Build Configuration:');
  console.log(`  Linux:   ${buildLinux ? '✓' : '✗'}`);
  console.log(`  Windows: ${buildWindows ? '✓' : '✗'}`);
  console.log(`  Mode:    ${portableOnly ? 'Portable only' : 'Full (portable + installer)'}`);
  console.log('');
  
  // Clean if requested
  if (cleanFirst) {
    cleanDist();
  }
  
  // Download miners for current platform first (needed for build)
  const currentPlatform = process.platform === 'win32' ? 'win32' : 'linux';
  await downloadMinersForPlatform(currentPlatform);
  
  // Build React app
  buildReact();
  
  // Track results
  const results = {
    linux: null,
    windows: null
  };
  
  // Build for each platform
  if (buildLinux) {
    results.linux = buildForLinux();
  }
  
  if (buildWindows) {
    results.windows = buildForWindows();
  }
  
  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Build Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  
  if (buildLinux) {
    if (results.linux === true) {
      console.log('  Linux:   ✓ Success');
    } else if (results.linux === false) {
      console.log('  Linux:   ✗ Failed');
    } else {
      console.log('  Linux:   ⊘ Skipped');
    }
  }
  if (buildWindows) {
    if (results.windows === true) {
      console.log('  Windows: ✓ Success');
    } else if (results.windows === false) {
      console.log('  Windows: ✗ Failed');
    } else {
      console.log('  Windows: ⊘ Skipped (wine32 required for cross-compile)');
    }
  }
  
  console.log('');
  console.log(`  Time: ${elapsed}s`);
  console.log('');
  
  // List output files
  if (fs.existsSync(DIST_DIR)) {
    const files = fs.readdirSync(DIST_DIR).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.appimage', '.exe', '.dmg', '.deb'].includes(ext);
    });
    
    if (files.length > 0) {
      console.log('  Output files:');
      files.forEach(file => {
        const filePath = path.join(DIST_DIR, file);
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
        console.log(`    📦 ${file} (${sizeMB} MB)`);
      });
      console.log('');
      console.log(`  Location: ${DIST_DIR}`);
    }
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  
  // Exit with error only if a build actually failed (not skipped)
  const anyFailed = Object.values(results).some(r => r === false);
  const anySucceeded = Object.values(results).some(r => r === true);
  
  if (anyFailed && !anySucceeded) {
    console.log('All builds failed.');
    process.exit(1);
  } else if (anyFailed) {
    console.log('Some builds failed. Check errors above.');
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
