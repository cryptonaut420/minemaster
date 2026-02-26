import React from 'react';
import './MinerConfig.css';
import { formatHashrate } from '../utils/formatters';
import { useGpuList } from '../hooks/useSystemInfo';

function NanominerConfig({ miner, onConfigChange, onStart, onStop, isBoundToMaster = false, defaultWorkerName = '' }) {
  const { gpuList, systemInfo } = useGpuList();
  const gpuDetectionComplete = systemInfo?.gpuDetectionStatus === 'complete';
  
  // Check if GPU is detected
  const hasGpu = !gpuDetectionComplete || (
    systemInfo?.gpus &&
    Array.isArray(systemInfo.gpus) &&
    systemInfo.gpus.length > 0 &&
    systemInfo.gpus.some(gpu => {
      if (!gpu) return false;
      const model = (gpu.model || gpu.name || '').toLowerCase();
      // Exclude "no gpu detected" or empty models
      return model &&
             !model.includes('no gpu') &&
             !model.includes('detected') &&
             model.trim().length > 0;
    })
  );
  
  const handleChange = (field, value) => {
    onConfigChange({
      ...miner.config,
      [field]: value
    });
  };

  // Helper to check if field should be disabled
  const isFieldDisabled = (field) => {
    if (!isBoundToMaster) return false;
    // Allow rigName to be edited even when bound
    return field !== 'rigName';
  };
  
  // Check if start button should be disabled
  const isStartDisabled = miner.loading || 
                          !miner.config.pool || 
                          !miner.config.user || 
                          !miner.config.algorithm ||
                          !hasGpu ||
                          miner.enabled === false;
  
  // Get disabled reason for tooltip
  const getDisabledReason = () => {
    if (miner.loading) return 'Miner is starting...';
    if (!miner.config.pool) return 'Pool address required';
    if (!miner.config.user) return 'Wallet address required';
    if (!miner.config.algorithm) return 'Algorithm required';
    if (!gpuDetectionComplete) return 'Detecting GPU...';
    if (!hasGpu) return 'No GPU detected';
    if (miner.enabled === false) return 'GPU mining is disabled';
    return 'Start Mining';
  };

  return (
    <div className="miner-config">
      <div className="config-header">
        <div className="config-title">
          <h2>{miner.name}</h2>
          <span className="device-badge">{miner.deviceType}</span>
          {miner.running && (
            miner.hashrate ? (
              <span className="hashrate-badge">{formatHashrate(miner.hashrate)}</span>
            ) : (
              <span className="hashrate-badge calculating">Calculating...</span>
            )
          )}
        </div>
        <div className="control-buttons">
          {!miner.running ? (
            <button 
              className={`btn btn-start ${!hasGpu ? 'disabled-no-gpu' : ''}`}
              onClick={onStart}
              disabled={isStartDisabled}
              title={getDisabledReason()}
            >
              {miner.loading ? '⏳ Starting...' : '▶ Start Mining'}
            </button>
          ) : (
            <button 
              className="btn btn-stop"
              onClick={onStop}
              disabled={miner.loading}
            >
              {miner.loading ? '⏳ Stopping...' : '⏹ Stop Mining'}
            </button>
          )}
        </div>
      </div>

      {/* Validation Errors */}
      {miner.validationErrors && miner.validationErrors.length > 0 && (
        <div className="validation-errors">
          {miner.validationErrors.map((error, idx) => (
            <div key={idx} className="validation-error">
              ⚠️ {error}
            </div>
          ))}
        </div>
      )}

      <div className="config-form">
        {gpuDetectionComplete && !hasGpu && (
          <div className="no-gpu-warning">
            ⚠️ No GPU detected - GPU mining is unavailable on this system. The Start Mining button is disabled.
          </div>
        )}
        
        {isBoundToMaster && (
          <div className="master-bound-notice">
            🔗 Bound to Master Server - Most settings are controlled remotely. Only rig name can be changed locally.
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Coin / Currency</label>
            <input
              type="text"
              placeholder="ETH"
              value={miner.config.coin}
              onChange={(e) => handleChange('coin', e.target.value.toUpperCase())}
              disabled={miner.running || isFieldDisabled('coin')}
            />
          </div>

          <div className="form-group">
            <label>Algorithm</label>
            <select
              value={miner.config.algorithm}
              onChange={(e) => handleChange('algorithm', e.target.value)}
              disabled={miner.running || isFieldDisabled('algorithm')}
            >
              <option value="ethash">Ethash (ETH, ETC, UBQ, EXP, MUSIC, ELLA)</option>
              <option value="etchash">Etchash (ETC)</option>
              <option value="kawpow">KawPow (RVN)</option>
              <option value="autolykos">Autolykos (ERG)</option>
              <option value="conflux">Octopus (CFX)</option>
              <option value="ton">TON</option>
              <option value="kaspa">Kaspa (KAS)</option>
              <option value="karlsenhash">Karlsen (KLS)</option>
              <option value="nexa">Nexa</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Pool Address</label>
          <input
            type="text"
            placeholder="eth.2miners.com:2020"
            value={miner.config.pool}
            onChange={(e) => handleChange('pool', e.target.value)}
            disabled={miner.running || isFieldDisabled('pool')}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Wallet Address</label>
            <input
              type="text"
              placeholder="Your wallet address"
              value={miner.config.user}
              onChange={(e) => handleChange('user', e.target.value)}
              disabled={miner.running || isFieldDisabled('user')}
            />
          </div>

          <div className="form-group">
            <label>Rig Name (optional)</label>
            <input
              type="text"
              placeholder={defaultWorkerName || 'worker1'}
              value={miner.config.rigName}
              onChange={(e) => handleChange('rigName', e.target.value)}
              disabled={miner.running || isFieldDisabled('rigName')}
            />
            <span className="field-hint">Identifies this machine on the pool. Defaults to {defaultWorkerName ? `"${defaultWorkerName}"` : 'hostname'} if empty.</span>
          </div>
        </div>

        {gpuList.length > 0 && (
          <div className="form-group">
            <label>GPU Configuration</label>
            <div className="gpu-selector-advanced">
              {gpuList.map((gpu, idx) => {
                const gpus = miner.config.gpus || [];
                const isSelected = gpus.length === 0 || gpus.includes(idx);
                
                return (
                  <div key={idx} className={`gpu-card ${isSelected ? 'selected' : ''}`}>
                    <div className="gpu-card-header">
                      <label className="gpu-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={miner.running || isFieldDisabled('gpus')}
                          onChange={(e) => {
                            let currentGpus = miner.config.gpus || [];
                            // If empty (all selected), expand to explicit list of all GPU indices
                            if (currentGpus.length === 0) {
                              currentGpus = gpuList.map((_, i) => i);
                            }
                            let newGpus;
                            if (e.target.checked) {
                              newGpus = currentGpus.includes(idx) ? currentGpus : [...currentGpus, idx];
                            } else {
                              newGpus = currentGpus.filter(g => g !== idx);
                            }
                            // If all GPUs selected again, collapse back to empty (= "all")
                            if (newGpus.length === gpuList.length) {
                              newGpus = [];
                            }
                            handleChange('gpus', newGpus);
                          }}
                        />
                        <strong>GPU {idx}</strong>
                      </label>
                    </div>
                    
                    <div className="gpu-card-body">
                      <div className="gpu-model">{gpu.model}</div>
                      
                      <div className="gpu-stats-grid">
                        <div className="gpu-stat">
                          <span className="gpu-stat-label">Usage:</span>
                          <span className="gpu-stat-value">
                            {gpu.usage !== null && gpu.usage !== undefined ? `${gpu.usage.toFixed(1)}%` : 'N/A'}
                          </span>
                        </div>
                        
                        <div className="gpu-stat">
                          <span className="gpu-stat-label">Temp:</span>
                          <span className="gpu-stat-value">
                            {gpu.temperature !== null && gpu.temperature !== undefined ? `${Math.round(gpu.temperature)}°C` : 'N/A'}
                          </span>
                        </div>
                        
                        {(gpu.vramUsed !== null && gpu.vramTotal !== null) && (
                          <div className="gpu-stat">
                            <span className="gpu-stat-label">VRAM:</span>
                            <span className="gpu-stat-value">
                              {(gpu.vramUsed / 1024).toFixed(1)} / {(gpu.vramTotal / 1024).toFixed(1)} GB
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NanominerConfig;
