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
          console.log('[SystemInfo] Loaded from cache (localStorage)');
          return parsed.data;
        }
      }
    } catch (e) {
      console.error('[SystemInfo] Failed to load from cache:', e);
    }
    return null;
  });

  useEffect(() => {
    let mounted = true;

    const loadSystemInfo = async () => {
      if (!window.electronAPI) return;
      
      try {
        const info = await window.electronAPI.getSystemInfo();
        
        if (mounted && info) {
          setSystemInfo(info);
          
          // Cache to localStorage with timestamp
          try {
            localStorage.setItem(CACHE_KEYS.SYSTEM_INFO, JSON.stringify({
              data: info,
              timestamp: Date.now()
            }));
            console.log('[SystemInfo] Saved to cache');
          } catch (e) {
            console.error('[SystemInfo] Failed to save to cache:', e);
          }
        }
      } catch (e) {
        console.error('[SystemInfo] Failed to fetch:', e);
      }
    };

    // Load immediately if not cached
    if (!systemInfo) {
      loadSystemInfo();
    }

    // Re-fetch in background after 3 seconds to update
    const refetchTimeout = setTimeout(loadSystemInfo, 3000);
    
    return () => {
      mounted = false;
      clearTimeout(refetchTimeout);
    };
  }, [systemInfo]);

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
          console.log('[SystemStats] Loaded from cache');
          return parsed.data;
        }
      }
    } catch (e) {
      console.error('[SystemStats] Failed to load from cache:', e);
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
            console.error('[SystemStats] Failed to save to cache:', e);
          }
        }
      } catch (e) {
        console.error('[SystemStats] Failed to fetch:', e);
      }
    };

    const initialTimeout = setTimeout(updateStats, systemStats ? 1000 : 0);
    const interval = setInterval(updateStats, 3000);

    return () => {
      mounted = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

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
        console.log('[GPUList] Loaded from cache');
        return JSON.parse(cached);
      }
    } catch (e) {
      console.error('[GPUList] Failed to load from cache:', e);
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
        console.error('[GPUList] Failed to save to cache:', e);
      }
    }
  }, [systemStats, systemInfo]);

  return gpuList;
}

