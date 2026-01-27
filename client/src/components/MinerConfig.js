import React from 'react';
import './MinerConfig.css';
import { formatHashrate } from '../utils/formatters';
import { useSystemInfo, useSystemStats } from '../hooks/useSystemInfo';
import SystemInfoCard from './SystemInfoCard';

function MinerConfig({ miner, onConfigChange, onStart, onStop }) {
  const systemInfo = useSystemInfo();
  const systemStats = useSystemStats();
  
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
              disabled={miner.loading || !miner.config.pool || !miner.config.user}
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
              placeholder="XMR"
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
              <option value="rx/0">RandomX (rx/0)</option>
              <option value="rx/wow">RandomWOW (rx/wow)</option>
              <option value="rx/arq">RandomARQ (rx/arq)</option>
              <option value="cn/r">CryptoNight R (cn/r)</option>
              <option value="cn/half">CryptoNight Half (cn/half)</option>
              <option value="ghostrider">GhostRider</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Pool Address</label>
          <input
            type="text"
            placeholder="pool.example.com:3333"
            value={miner.config.pool}
            onChange={(e) => handleChange('pool', e.target.value)}
            disabled={miner.running}
          />
        </div>

        <div className="form-row">
        <div className="form-group">
          <label>Wallet Address / Username</label>
          <input
            type="text"
            placeholder="Your wallet address"
            value={miner.config.user}
            onChange={(e) => handleChange('user', e.target.value)}
            disabled={miner.running}
          />
        </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="text"
              placeholder="x"
              value={miner.config.password}
              onChange={(e) => handleChange('password', e.target.value)}
              disabled={miner.running}
            />
          </div>
        </div>

        <div className="form-group thread-control">
          <label>
            CPU Usage: <span className="thread-percentage">{miner.config.threadPercentage || 100}%</span>
            {navigator.hardwareConcurrency && (
              <span className="thread-count">
                ({Math.max(1, Math.round(navigator.hardwareConcurrency * ((miner.config.threadPercentage || 100) / 100)))} / {navigator.hardwareConcurrency} threads)
              </span>
            )}
          </label>
          <div className="slider-container">
            <input
              type="range"
              min="10"
              max="100"
              step="10"
              value={miner.config.threadPercentage || 100}
              onChange={(e) => handleChange('threadPercentage', parseInt(e.target.value))}
              disabled={miner.running}
              className="thread-slider"
            />
            <div className="slider-ticks">
              <span>10%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* System Info for CPU Miner */}
        {miner.deviceType === 'CPU' && (
          <SystemInfoCard systemInfo={systemInfo} systemStats={systemStats} />
        )}

        <div className="form-group">
          <label>Additional Arguments (optional)</label>
          <input
            type="text"
            placeholder="--tls --keepalive"
            value={miner.config.additionalArgs}
            onChange={(e) => handleChange('additionalArgs', e.target.value)}
            disabled={miner.running}
          />
        </div>
      </div>
    </div>
  );
}

export default MinerConfig;
