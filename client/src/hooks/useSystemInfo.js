import { useState, useEffect } from 'react';

// Cache keys
const CACHE_KEYS = {
  SYSTEM_INFO: 'minemaster-system-info',
  SYSTEM_STATS: 'minemaster-system-stats-last',
  GPU_LIST: 'minemaster-gpu-list'
};

export function useSystemInfo() {
  const [systemInfo, setSystemInfo] = useState(() => {
    // Try localStorage first (persists across app restarts)
    try {
      const cached = localStorage.getItem(CACHE_KEYS.SYSTEM_INFO);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Check if cache is less than 24 hours old
        if (parsed.timestamp && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          return parsed.data;
        }
      }
    } catch (e) {
      // Silent fail - will fetch fresh data
    }
    return null;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let mounted = true;

    const loadSystemInfo = async () => {
      if (!window.electronAPI) return;
      
      try {
        const info = await window.electronAPI.getSystemInfo();
        
        if (mounted && info) {
          setSystemInfo(info);
          
          try {
            localStorage.setItem(CACHE_KEYS.SYSTEM_INFO, JSON.stringify({
              data: info,
              timestamp: Date.now()
            }));
          } catch (e) {
            // Silent fail on cache save
          }
        }
      } catch (e) {
        // Silent fail - will retry
      }
    };

    loadSystemInfo();

    // Re-fetch once after 3s to pick up completed GPU detection
    const refetchTimeout = setTimeout(loadSystemInfo, 3000);
    
    return () => {
      mounted = false;
      clearTimeout(refetchTimeout);
    };
  }, []);

  return systemInfo;
}

export function useSystemStats() {
  const [systemStats, setSystemStats] = useState(() => {
    // Load last known stats from cache immediately
    try {
      const cached = localStorage.getItem(CACHE_KEYS.SYSTEM_STATS);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Use cached data if less than 30 seconds old
        if (parsed.timestamp && Date.now() - parsed.timestamp < 30000) {
          return parsed.data;
        }
      }
    } catch (e) {
      // Silent fail - will fetch fresh data
    }
    return null;
  });

  useEffect(() => {
    let mounted = true;

    const updateStats = async () => {
      if (!mounted || !window.electronAPI) return;

      try {
        const [cpu, memory, gpu] = await Promise.all([
          window.electronAPI.getCpuStats(),
          window.electronAPI.getMemoryStats(),
          window.electronAPI.getGpuStats()
        ]);

        if (mounted) {
          const newStats = { cpu, memory, gpu };
          setSystemStats(newStats);
          
          // Cache the stats
          try {
            localStorage.setItem(CACHE_KEYS.SYSTEM_STATS, JSON.stringify({
              data: newStats,
              timestamp: Date.now()
            }));
          } catch (e) {
            // Silent fail on cache save
          }
        }
      } catch (e) {
        // Silent fail - will retry on interval
      }
    };

    const initialTimeout = setTimeout(updateStats, systemStats ? 1000 : 0);
    const interval = setInterval(updateStats, 3000);

    return () => {
      mounted = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return systemStats;
}

export function useGpuList() {
  const systemStats = useSystemStats();
  const systemInfo = useSystemInfo();
  
  const [gpuList, setGpuList] = useState(() => {
    // Load GPU list from cache
    try {
      const cached = localStorage.getItem(CACHE_KEYS.GPU_LIST);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (e) {
      // Silent fail - will build from live data
    }
    return [];
  });

  useEffect(() => {
    // Update GPU list when stats or info changes
    if (systemStats?.gpu && Array.isArray(systemStats.gpu)) {
      const enrichedList = systemStats.gpu.map((gpu, idx) => ({
        ...gpu,
        model: systemInfo?.gpus?.[idx]?.model || `GPU ${idx}`,
        vramTotal: gpu.vramTotal || systemInfo?.gpus?.[idx]?.vram || null
      }));
      
      setGpuList(enrichedList);
      
      // Cache the GPU list
      try {
        localStorage.setItem(CACHE_KEYS.GPU_LIST, JSON.stringify(enrichedList));
      } catch (e) {
        // Silent fail on cache save
      }
    }
  }, [systemStats, systemInfo]);

  return {
    gpuList,
    systemInfo
  };
}

