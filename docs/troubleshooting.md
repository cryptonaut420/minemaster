# Troubleshooting Guide

Common issues and solutions for MineMaster.

## 📋 Table of Contents

1. [Installation Issues](#installation-issues)
2. [Miner Issues](#miner-issues)
3. [Connection Issues](#connection-issues)
4. [Performance Issues](#performance-issues)
5. [GPU Detection Issues](#gpu-detection-issues)
6. [System Issues](#system-issues)

## 🔧 Installation Issues

### npm install fails with EACCES permission denied

**Problem**: Permission errors when installing dependencies.

**Solution**:
```bash
# Fix ownership
sudo chown -R $USER:$USER /var/www/Ironclad/minemaster

# Then install
cd /var/www/Ironclad/minemaster/client
npm install --legacy-peer-deps
```

### npm install fails with gyp build error

**Problem**: Native module compilation fails.

**Solution**:

**Linux**:
```bash
sudo apt-get install build-essential python3
npm install --legacy-peer-deps
```

**macOS**:
```bash
xcode-select --install
npm install --legacy-peer-deps
```

**Windows**:
```powershell
# Install Visual Studio Build Tools
npm install --legacy-peer-deps
```

### Miner binaries not downloaded

**Problem**: `miners/xmrig/` or `miners/nanominer/` is empty.

**Solution**:
```bash
# Re-run download script
npm run setup

# Or manually download:
# XMRig: https://github.com/xmrig/xmrig/releases
# Nanominer: https://github.com/nanopool/nanominer/releases
# Extract to respective directories
```

### Permission denied: Cannot execute miner

**Problem**: `EACCES: permission denied` when starting miner.

**Solution**:
```bash
# Make binaries executable
chmod +x miners/xmrig/xmrig
chmod +x miners/nanominer/nanominer

# Check permissions
ls -la miners/xmrig/xmrig
ls -la miners/nanominer/nanominer
```

### App won't start on Linux

**Problem**: Electron app fails to launch.

**Solution**:
```bash
# Install missing libraries
sudo apt-get update
sudo apt-get install libgconf-2-4 libatk1.0-0 libatk-bridge2.0-0 \
                     libgdk-pixbuf2.0-0 libgtk-3-0 libgbm-dev \
                     libnss3 libxss1 libasound2

# For AppImage
chmod +x MineMaster-*.AppImage
./MineMaster-*.AppImage --no-sandbox  # If sandbox issues
```

## ⛏️ Miner Issues

### Miner fails to start

**Problem**: "Failed to start miner" error.

**Check**:
1. **Miner binary exists**:
   ```bash
   ls -la miners/xmrig/xmrig
   ls -la miners/nanominer/nanominer
   ```

2. **Executable permissions** (Linux/macOS):
   ```bash
   chmod +x miners/xmrig/xmrig
   chmod +x miners/nanominer/nanominer
   ```

3. **Configuration is valid**:
   - Pool address format: `host:port`
   - Wallet address is correct for coin
   - Algorithm matches coin

4. **Port not blocked**:
   ```bash
   # Test connection
   telnet pool.supportxmr.com 3333
   ```

### Miner starts then immediately stops

**Problem**: Miner exits with code 1 or crashes.

**Common Causes**:

1. **Invalid wallet address**:
   - Check wallet address format
   - Ensure it matches the coin you're mining
   - Verify no extra spaces

2. **Pool connection failed**:
   - Check internet connection
   - Try different pool server
   - Check firewall rules

3. **Algorithm mismatch**:
   - Verify algorithm matches coin
   - Example: Monero = `rx/0`, Ravencoin = `kawpow`

4. **Insufficient memory** (CPU mining):
   - RandomX needs 2GB+ RAM per thread
   - Reduce CPU usage percentage
   - Close other applications

5. **GPU not supported** (GPU mining):
   - Check GPU has enough VRAM
   - Update GPU drivers
   - Verify algorithm supports your GPU

**Check console output** for specific error:
```
[ERROR] connection failed
[ERROR] invalid algorithm
[ERROR] GPU not found
```

### Miner output shows "Failed to allocate memory"

**Problem**: RandomX can't allocate huge pages.

**Solution (Linux)**:
```bash
# Set huge pages (temporary)
sudo sysctl -w vm.nr_hugepages=1280

# Make permanent
echo "vm.nr_hugepages=1280" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**Solution (Windows)**:
1. Run as Administrator
2. Or disable huge pages: Additional Args: `--no-huge-pages`

### XMRig shows "FAILED TO APPLY MSR MOD"

**Problem**: Cannot apply CPU MSR optimizations.

**Solution**:
This is a warning, not critical. To fix:

**Linux**:
```bash
# Load msr module
sudo modprobe msr

# Make permanent
echo "msr" | sudo tee -a /etc/modules
```

**Windows**:
- Run MineMaster as Administrator

Or ignore: Mining will work, just slightly less efficient.

### Nanominer shows "No GPUs detected"

**Problem**: Nanominer can't find GPUs.

**Solution**:

**Check GPU is visible**:
```bash
# AMD
ls /sys/class/drm/card*/device/

# NVIDIA
nvidia-smi
```

**AMD GPUs**:
```bash
# Install OpenCL
sudo apt-get install ocl-icd-opencl-dev

# Check OpenCL devices
clinfo
```

**NVIDIA GPUs**:
```bash
# Install NVIDIA drivers
sudo ubuntu-drivers autoinstall

# Or specific version
sudo apt-get install nvidia-driver-525

# Verify
nvidia-smi
```

**Windows**:
- Update GPU drivers from AMD/NVIDIA website
- Restart computer

### Hashrate shown as "Calculating..." forever

**Problem**: No hashrate detected from miner output.

**Causes**:
1. Miner not connected to pool yet
2. Output parsing failed
3. Miner crashed silently

**Solution**:
1. Wait 30-60 seconds for pool connection
2. Check console output for errors
3. Look for "accepted" shares in output
4. Restart miner if no output after 2 minutes

## 🌐 Connection Issues

### "Connection failed" or "Pool offline"

**Problem**: Can't connect to mining pool.

**Check**:
1. **Internet connection**:
   ```bash
   ping 8.8.8.8
   ```

2. **Pool reachable**:
   ```bash
   telnet pool.supportxmr.com 3333
   # Or
   nc -zv pool.supportxmr.com 3333
   ```

3. **Firewall rules**:
   ```bash
   # Linux - Allow mining ports
   sudo ufw allow out 3333/tcp
   sudo ufw allow out 443/tcp
   ```

4. **Try different pool**:
   - Pool might be down
   - Check pool's status page
   - Try backup pool

### High rejection rate (>5%)

**Problem**: Many shares rejected by pool.

**Causes**:
1. **High network latency**:
   - Choose closer pool server
   - Check ping to pool:
     ```bash
     ping pool.supportxmr.com
     ```

2. **Overclocking too aggressive**:
   - Reduce GPU overclock
   - Lower memory/core clocks
   - Increase voltage slightly

3. **Wrong difficulty**:
   - Try different pool port (higher/lower difficulty)

4. **Stale shares**:
   - Improve internet connection
   - Use wired connection instead of WiFi

### "Stratum authentication failed"

**Problem**: Pool rejects your credentials.

**Solution**:
1. Verify wallet address is correct
2. Check algorithm matches pool requirements
3. Try password `x` (most pools)
4. Check pool requires specific password format

## 🚀 Performance Issues

### Low hashrate compared to expected

**CPU Mining**:
1. **Check CPU usage**:
   - Open Task Manager / htop
   - Verify CPU at expected usage %
   - Close competing applications

2. **RAM speed**:
   - Enable XMP/DOCP in BIOS
   - Verify RAM running at rated speed

3. **Huge pages**:
   ```bash
   # Check huge pages
   cat /proc/meminfo | grep Huge
   
   # Set if needed
   sudo sysctl -w vm.nr_hugepages=1280
   ```

4. **SMT/Hyperthreading**:
   - Try disabling in BIOS
   - Some algorithms faster without it

**GPU Mining**:
1. **Check GPU usage**:
   - Should be 95-100% when mining
   - If low, increase power limit

2. **Thermal throttling**:
   - Check GPU temperature
   - Should be <80°C
   - Increase fan speed or improve cooling

3. **Power limit too low**:
   - Increase power limit in MineMaster
   - Try 75-85% first

4. **Drivers outdated**:
   - Update to latest GPU drivers
   - AMD: Adrenalin drivers
   - NVIDIA: Game Ready drivers

5. **Wrong algorithm**:
   - Verify algorithm setting
   - Check pool requirements

### High CPU/GPU temperature

**Immediate Actions**:
1. **Reduce usage**:
   - Lower CPU percentage
   - Reduce GPU power limit to 65-75%

2. **Increase fan speed**:
   - Use MSI Afterburner or similar
   - Set aggressive fan curve

**Long-term Solutions**:
1. **Improve airflow**:
   - Open case side panel
   - Add case fans
   - Position in cooler location

2. **Clean hardware**:
   - Remove dust from heatsinks
   - Clean GPU fans
   - Replace thermal paste

3. **Better cooling**:
   - Upgrade CPU cooler
   - Add GPU cooling (if supported)

**Safe Temperature Limits**:
- CPU: <80°C (ideal: 60-75°C)
- GPU: <75°C (ideal: 60-70°C)

### System becomes unresponsive

**Problem**: Computer freezes or very slow when mining.

**Solutions**:
1. **Reduce CPU usage**:
   - Lower CPU percentage to 50-75%
   - Leave threads for system

2. **Close other applications**:
   - Mining uses significant resources
   - Close browsers, games, etc.

3. **Increase system RAM**:
   - RandomX needs 2GB per thread
   - Upgrade if insufficient

4. **Lower GPU power**:
   - Reduce to 75% or lower
   - Allows GPU for display

## 🎮 GPU Detection Issues

### No GPUs shown in MineMaster

**Problem**: GPU section empty or shows "No GPU detected".

**Linux**:
```bash
# Check GPU present
lspci | grep -i vga
lspci | grep -i nvidia
lspci | grep -i amd

# AMD - Check drivers
ls /sys/class/drm/card*/device/

# NVIDIA - Check drivers
nvidia-smi

# Install drivers if missing
# AMD
sudo apt-get install amdgpu-dkms

# NVIDIA
sudo ubuntu-drivers autoinstall
```

**Windows**:
1. Open Device Manager
2. Check "Display adapters"
3. If yellow warning, update drivers
4. Download from AMD/NVIDIA website

**macOS**:
- Built-in GPUs should work
- External GPUs may need eGPU setup

### Only integrated GPU detected

**Problem**: Discrete GPU (AMD/NVIDIA) not showing.

**Solution**:
1. **Enable in BIOS**:
   - Check discrete GPU enabled
   - PCIe slot active
   - Verify not in integrated-only mode

2. **Install proper drivers**:
   - Not Windows basic drivers
   - Full AMD Adrenalin or NVIDIA drivers

3. **Power connected** (desktop GPUs):
   - Check PCIe power cables connected
   - GPU power LED lit

4. **Reseat GPU**:
   - Power off, remove GPU
   - Clean contacts
   - Reinstall firmly

### GPU stats not updating

**Problem**: Temperature, usage always show "N/A".

**Solution**:

**Linux**:
```bash
# AMD - Check sysfs access
ls -la /sys/class/drm/card0/device/hwmon/
cat /sys/class/drm/card0/device/gpu_busy_percent

# NVIDIA - Check nvidia-smi
nvidia-smi --query-gpu=temperature.gpu --format=csv
```

**Permission issue (Linux)**:
```bash
# Add user to video group
sudo usermod -a -G video $USER
# Log out and back in
```

**Windows**:
- Update GPU drivers
- Restart application

## 💻 System Issues

### Application crashes on startup

**Problem**: MineMaster closes immediately after launch.

**Check**:
1. **Console output** (if running from terminal):
   ```bash
   npm start 2>&1 | tee error.log
   ```

2. **Electron logs**:
   - Linux: `~/.config/minemaster/logs/`
   - Windows: `%APPDATA%\minemaster\logs\`
   - macOS: `~/Library/Logs/minemaster/`

**Common Causes**:
- Corrupted config: Delete `~/.config/minemaster/`
- Missing libraries: Install dependencies
- Port 3000 in use: Change port or kill process

### High memory usage

**Problem**: Application using excessive RAM.

**Normal Usage**:
- Electron app: 100-200 MB
- Per running miner: 50-200 MB
- RandomX: 2GB+ per CPU thread

**If excessive**:
1. Clear console output (use "Clear" button)
2. Restart application
3. Reduce CPU thread count
4. Check for memory leaks (report as bug)

### Configuration not saving

**Problem**: Settings reset after restart.

**Check**:
1. **Browser localStorage** (dev mode):
   ```javascript
   // In DevTools console
   localStorage.getItem('minemaster-config')
   ```

2. **File permissions**:
   ```bash
   # Linux
   ls -la ~/.config/minemaster/
   
   # Fix if needed
   chown -R $USER:$USER ~/.config/minemaster/
   ```

3. **Incognito/Private mode**:
   - Don't use private browsing mode
   - localStorage cleared on exit

### Can't stop miner / Miner keeps running after close

**Problem**: Miner process doesn't terminate.

**Solution**:
```bash
# Find miner process
ps aux | grep xmrig
ps aux | grep nanominer

# Kill process
kill -9 <PID>

# Or kill all
killall -9 xmrig nanominer
```

**Windows**:
```powershell
# Task Manager → Find process → End Task
# Or PowerShell
taskkill /F /IM xmrig.exe
taskkill /F /IM nanominer.exe
```

## 🔍 Diagnostic Tools

### Collect System Information

```bash
# Linux
# System info
uname -a
lsb_release -a

# CPU info
lscpu
cat /proc/cpuinfo

# Memory
free -h

# GPU
lspci | grep -i vga
nvidia-smi  # NVIDIA
rocm-smi    # AMD

# Temperature
sensors
```

### Check Miner Logs

**XMRig console output**:
- Look for "accepted" shares
- Check connection status
- Note any warnings/errors

**Nanominer console output**:
- GPU detection messages
- Hashrate per GPU
- Share acceptance

### Test Pool Connection

```bash
# Test TCP connection
nc -zv pool.supportxmr.com 3333
telnet pool.supportxmr.com 3333

# Ping (not all pools respond)
ping pool.supportxmr.com
```

## 📞 Getting Help

### Before Asking for Help

1. **Check this guide** for your issue
2. **Search existing issues** on GitHub
3. **Collect logs and errors**:
   - Console output
   - System information
   - Configuration (redact wallet)

### Reporting Issues

Include:
- **OS and version**: Linux distro, Windows 10/11, macOS version
- **MineMaster version**: Check in About or package.json
- **Hardware**: CPU model, GPU model
- **Error messages**: Full console output
- **Steps to reproduce**: What you did before error

### Community Support

- GitHub Issues: Technical problems
- Reddit/Discord: General questions
- Pool Discord: Pool-specific issues

---

**Last Updated**: January 2026
