#!/bin/bash

# Enable MSR mod and huge pages for optimal RandomX (XMRig) performance on Linux
# Run with: sudo bash enable-msr.sh
# Can be re-run safely - skips steps that are already applied

set -e

if [ "$EUID" -ne 0 ]; then
  echo "This script must be run as root: sudo bash $0"
  exit 1
fi

echo "=== XMRig Performance Optimizer ==="
echo ""

# 1. Enable MSR kernel module
echo "[1/3] Enabling MSR module..."
if lsmod | grep -q "^msr "; then
  echo "  MSR module already loaded."
else
  modprobe msr
  echo "  MSR module loaded."
fi

# Grant read/write access to MSR registers (needed for RandomX boost)
if ls /dev/cpu/*/msr &>/dev/null; then
  chmod o+rw /dev/cpu/*/msr
  echo "  MSR access granted to all users."
else
  echo "  WARNING: /dev/cpu/*/msr not found. Your kernel may not support MSR."
fi

# 2. Enable huge pages
echo ""
echo "[2/3] Enabling huge pages..."

# Calculate pages needed (2MB per page, ~2336MB for RandomX = 1168 pages)
# Add some headroom for the system
CURRENT_PAGES=$(sysctl -n vm.nr_hugepages)
TARGET_PAGES=1168

if [ "$CURRENT_PAGES" -ge "$TARGET_PAGES" ]; then
  echo "  Huge pages already set to $CURRENT_PAGES (target: $TARGET_PAGES)."
else
  sysctl -w vm.nr_hugepages=$TARGET_PAGES > /dev/null
  ACTUAL=$(sysctl -n vm.nr_hugepages)
  echo "  Huge pages set to $ACTUAL (was $CURRENT_PAGES)."
  if [ "$ACTUAL" -lt "$TARGET_PAGES" ]; then
    echo "  WARNING: Only $ACTUAL of $TARGET_PAGES pages allocated. System may not have enough free RAM."
    echo "  Try rebooting and running this script early before other apps consume memory."
  fi
fi

# 3. Persist across reboots
echo ""
echo "[3/3] Persisting settings for reboot..."

# Persist huge pages
if grep -q "^vm.nr_hugepages" /etc/sysctl.conf; then
  sed -i "s/^vm.nr_hugepages.*/vm.nr_hugepages=$TARGET_PAGES/" /etc/sysctl.conf
  echo "  Updated vm.nr_hugepages in /etc/sysctl.conf."
else
  echo "vm.nr_hugepages=$TARGET_PAGES" >> /etc/sysctl.conf
  echo "  Added vm.nr_hugepages to /etc/sysctl.conf."
fi

# Persist MSR module load
if grep -q "^msr$" /etc/modules-load.d/*.conf 2>/dev/null; then
  echo "  MSR module already in /etc/modules-load.d/."
else
  echo "msr" > /etc/modules-load.d/msr.conf
  echo "  Added MSR module to /etc/modules-load.d/msr.conf."
fi

# Persist MSR permissions via udev rule
UDEV_RULE='/etc/udev/rules.d/99-msr.rules'
if [ -f "$UDEV_RULE" ]; then
  echo "  Udev rule for MSR permissions already exists."
else
  echo 'SUBSYSTEM=="msr", ACTION=="add", MODE="0666"' > "$UDEV_RULE"
  echo "  Created udev rule for MSR permissions."
fi

echo ""
echo "=== Done ==="
echo "  - MSR mod: enabled (15-30% hashrate boost)"
echo "  - Huge pages: $TARGET_PAGES pages (~$(( TARGET_PAGES * 2 ))MB)"
echo "  - Settings will persist across reboots"
echo ""
echo "Restart XMRig to apply. You should see:"
echo "  huge pages 100%  (instead of 0%)"
echo "  MSR mod applied  (instead of FAILED)"
