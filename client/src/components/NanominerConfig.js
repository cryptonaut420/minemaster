import React from 'react';
import './MinerConfig.css';
import { formatHashrate } from '../utils/formatters';
import { useSystemInfo, useGpuList } from '../hooks/useSystemInfo';

function NanominerConfig({ miner, onConfigChange, onStart, onStop }) {
  const systemInfo = useSystemInfo();
  const gpuList = useGpuList();
  
  const handleChange = (field, value) => {
    onConfigChange({
      ...miner.config,
      [field]: value
    });
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
              className="btn btn-start"
              onClick={onStart}
              disabled={miner.loading || !miner.config.pool || !miner.config.user || !miner.config.algorithm}
              title={!miner.config.pool || !miner.config.user ? 'Pool address and wallet address required' : 'Start Mining'}
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
        <div className="form-row">
          <div className="form-group">
            <label>Coin / Currency</label>
            <input
              type="text"
              placeholder="ETH"
              value={miner.config.coin}
              onChange={(e) => handleChange('coin', e.target.value.toUpperCase())}
              disabled={miner.running}
            />
          </div>

          <div className="form-group">
            <label>Algorithm</label>
            <select
              value={miner.config.algorithm}
              onChange={(e) => handleChange('algorithm', e.target.value)}
              disabled={miner.running}
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
            disabled={miner.running}
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
              disabled={miner.running}
            />
          </div>

          <div className="form-group">
            <label>Rig Name (optional)</label>
            <input
              type="text"
              placeholder="worker1"
              value={miner.config.rigName}
              onChange={(e) => handleChange('rigName', e.target.value)}
              disabled={miner.running}
            />
          </div>
        </div>

        {gpuList.length > 0 && (
          <div className="form-group">
            <label>GPU Configuration</label>
            <div className="gpu-selector-advanced">
              {gpuList.map((gpu, idx) => {
                const isSelected = miner.config.gpus.length === 0 || miner.config.gpus.includes(idx);
                
                return (
                  <div key={idx} className={`gpu-card ${isSelected ? 'selected' : ''}`}>
                    <div className="gpu-card-header">
                      <label className="gpu-checkbox-inline">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            let newGpus = [...(miner.config.gpus || [])];
                            if (e.target.checked) {
                              if (!newGpus.includes(idx)) {
                                newGpus.push(idx);
                              }
                            } else {
                              newGpus = newGpus.filter(g => g !== idx);
                            }
                            handleChange('gpus', newGpus);
                          }}
                          disabled={miner.running}
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
                      
                      {isSelected && (
                        <div className="gpu-intensity-control">
                          <label>
                            Power Limit: <span className="intensity-value">{miner.config[`gpu${idx}Power`] || 100}%</span>
                          </label>
                          <input
                            type="range"
                            min="50"
                            max="100"
                            step="5"
                            value={miner.config[`gpu${idx}Power`] || 100}
                            onChange={(e) => handleChange(`gpu${idx}Power`, parseInt(e.target.value))}
                            disabled={miner.running}
                            className="intensity-slider"
                          />
                          <div className="slider-ticks-small">
                            <span>50%</span>
                            <span>75%</span>
                            <span>100%</span>
                          </div>
                        </div>
                      )}
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
