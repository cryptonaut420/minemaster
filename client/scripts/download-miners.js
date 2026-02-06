#!/usr/bin/env node

/**
 * MineMaster Miner Download Script
 * Downloads and extracts mining software binaries
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MINERS_DIR = path.join(__dirname, '../miners');

// Miner definitions
const MINERS = {
  xmrig: {
    version: '6.25.0',
    linux: {
      url: 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-noble-x64.tar.gz',
      archive: 'xmrig-6.25.0-noble-x64.tar.gz',
      extractedDir: 'xmrig-6.25.0',
      binary: 'xmrig'
    },
    win32: {
      url: 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-msvc-win64.zip',
      archive: 'xmrig-6.25.0-msvc-win64.zip',
      extractedDir: 'xmrig-6.25.0',
      binary: 'xmrig.exe'
    },
    darwin: {
      url: 'https://github.com/xmrig/xmrig/releases/download/v6.25.0/xmrig-6.25.0-macos-x64.tar.gz',
      archive: 'xmrig-6.25.0-macos-x64.tar.gz',
      extractedDir: 'xmrig-6.25.0',
      binary: 'xmrig'
    }
  },
  nanominer: {
    version: '3.9.2',
    linux: {
      url: 'https://github.com/nanopool/nanominer/releases/download/v3.9.2/nanominer-linux-3.9.2.tar.gz',
      archive: 'nanominer-linux-3.9.2.tar.gz',
      extractedDir: 'nanominer-linux-3.9.2',
      binary: 'nanominer'
    },
    win32: {
      url: 'https://github.com/nanopool/nanominer/releases/download/v3.9.2/nanominer-windows-3.9.2.zip',
      archive: 'nanominer-windows-3.9.2.zip',
      extractedDir: 'nanominer-windows-3.9.2',
      binary: 'nanominer.exe'
    }
  }
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const percent = Math.floor((downloadedSize / totalSize) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          process.stdout.write(`\rProgress: ${percent}%`);
          lastPercent = percent;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\nDownload complete!');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

function extract(archive, destDir, extractedDir) {
  console.log(`Extracting: ${archive}`);
  const archivePath = path.join(destDir, archive);
  
  try {
    if (archive.endsWith('.tar.gz')) {
      // Extract tar.gz
      if (process.platform === 'win32') {
        // Windows: Use tar command (available on Windows 10 1803+) or PowerShell
        try {
          // Try native tar first (works on Windows 10 1803+)
          execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
        } catch (tarError) {
          // Fallback: Use PowerShell with .NET
          console.log('Native tar failed, trying PowerShell...');
          const psScript = `
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $gzStream = [System.IO.File]::OpenRead('${archivePath.replace(/\\/g, '\\\\')}')
            $gzipStream = New-Object System.IO.Compression.GzipStream($gzStream, [System.IO.Compression.CompressionMode]::Decompress)
            $tarPath = '${archivePath.replace(/\\/g, '\\\\').replace('.gz', '')}'
            $tarStream = [System.IO.File]::Create($tarPath)
            $gzipStream.CopyTo($tarStream)
            $tarStream.Close()
            $gzipStream.Close()
            $gzStream.Close()
          `;
          execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: 'inherit' });
          // Then extract the tar
          execSync(`tar -xf "${archivePath.replace('.gz', '')}" -C "${destDir}"`, { stdio: 'inherit' });
          // Clean up intermediate tar file
          try { fs.unlinkSync(archivePath.replace('.gz', '')); } catch (e) {}
        }
      } else {
        // Linux/macOS: Use native tar
        execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
      }
    } else if (archive.endsWith('.zip')) {
      // Extract zip
      if (process.platform === 'win32') {
        // Windows: Use PowerShell Expand-Archive
        const escapedArchive = archivePath.replace(/'/g, "''");
        const escapedDest = destDir.replace(/'/g, "''");
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${escapedArchive}' -DestinationPath '${escapedDest}' -Force"`, { stdio: 'inherit' });
      } else {
        // Linux/macOS: Use unzip
        execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' });
      }
    }
    
    // Move contents from extracted directory to parent
    const extractedPath = path.join(destDir, extractedDir);
    if (fs.existsSync(extractedPath)) {
      const files = fs.readdirSync(extractedPath);
      files.forEach(file => {
        const src = path.join(extractedPath, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(dest)) {
          fs.rmSync(dest, { recursive: true, force: true });
        }
        fs.renameSync(src, dest);
      });
      // Use fs.rmSync for better cross-platform compatibility
      fs.rmSync(extractedPath, { recursive: true, force: true });
    }
    
    // Remove archive
    fs.unlinkSync(archivePath);
    console.log('Extraction complete!');
  } catch (error) {
    console.error(`Extraction failed: ${error.message}`);
    throw error;
  }
}

function setExecutable(filePath) {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o755);
      console.log(`Set executable permissions: ${filePath}`);
    } catch (error) {
      console.error(`Failed to set permissions: ${error.message}`);
    }
  }
}

async function downloadMiner(minerName, minerConfig, targetPlatform) {
  const platform = targetPlatform || process.platform;
  const config = minerConfig[platform];
  
  if (!config) {
    console.log(`⚠️  No ${minerName} binary available for platform: ${platform}`);
    return;
  }

  const minerDir = path.join(MINERS_DIR, minerName);
  
  // Create miner directory if it doesn't exist
  if (!fs.existsSync(minerDir)) {
    fs.mkdirSync(minerDir, { recursive: true });
  }

  const binaryPath = path.join(minerDir, config.binary);
  
  // Check if binary already exists
  if (fs.existsSync(binaryPath)) {
    console.log(`✓ ${minerName} (${platform}) already exists at ${binaryPath}`);
    return;
  }

  console.log(`\n📥 Downloading ${minerName} v${minerConfig.version} for ${platform}...`);
  
  const archivePath = path.join(minerDir, config.archive);
  
  try {
    await download(config.url, archivePath);
    extract(config.archive, minerDir, config.extractedDir);
    setExecutable(binaryPath);
    console.log(`✓ ${minerName} (${platform}) installed successfully!\n`);
  } catch (error) {
    console.error(`❌ Failed to download ${minerName} for ${platform}: ${error.message}\n`);
    throw error;
  }
}

async function main() {
  // Parse CLI args: --platform <platform> or --all
  const args = process.argv.slice(2);
  const allPlatforms = args.includes('--all');
  const platformIdx = args.indexOf('--platform');
  const targetPlatform = platformIdx !== -1 ? args[platformIdx + 1] : null;

  // Determine which platforms to download for
  let platforms;
  if (allPlatforms) {
    platforms = ['linux', 'win32'];
    console.log('🔧 MineMaster Miner Setup (all platforms)\n');
  } else if (targetPlatform) {
    platforms = [targetPlatform];
    console.log(`🔧 MineMaster Miner Setup (${targetPlatform})\n`);
  } else {
    platforms = [process.platform];
    console.log('🔧 MineMaster Miner Setup\n');
  }

  console.log('═══════════════════════════════════════\n');
  
  // Create miners directory
  if (!fs.existsSync(MINERS_DIR)) {
    fs.mkdirSync(MINERS_DIR, { recursive: true });
  }

  // Download all miners for each target platform
  for (const platform of platforms) {
    for (const [minerName, minerConfig] of Object.entries(MINERS)) {
      try {
        await downloadMiner(minerName, minerConfig, platform);
      } catch (error) {
        console.error(`Failed to setup ${minerName} for ${platform}, continuing...\n`);
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('✓ Setup complete!\n');
  if (!allPlatforms && !targetPlatform) {
    console.log('Run "npm start" to launch MineMaster');
  }
  console.log('Tip: Use --all to download miners for all platforms (for cross-platform builds)');
}

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Setup failed:', err);
    process.exit(1);
  });
}

module.exports = { downloadMiner, MINERS };
