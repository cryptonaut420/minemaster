# MineMaster Documentation

Welcome to the MineMaster documentation! MineMaster is a cross-platform GUI wrapper for cryptocurrency mining software, providing an easy-to-use interface for managing CPU and GPU mining operations.

## 📚 Documentation Index

### Getting Started
- **[Installation Guide](installation.md)** - How to install and set up MineMaster
- **[Quick Start](quick-start.md)** - Get mining in 5 minutes
- **[User Guide](user-guide.md)** - Complete guide to using MineMaster

### Technical Documentation
- **[Architecture Overview](architecture.md)** - System design and architecture
- **[Development Guide](development.md)** - For developers wanting to contribute
- **[API Reference](api-reference.md)** - IPC communication and API details

### Mining Configuration
- **[Mining Configuration Guide](mining-configuration.md)** - Detailed mining setup
- **[Supported Algorithms & Coins](supported-coins.md)** - What you can mine
- **[Pool Configuration](pool-configuration.md)** - Setting up mining pools

### Reference
- **[Troubleshooting](troubleshooting.md)** - Common issues and solutions
- **[FAQ](faq.md)** - Frequently asked questions
- **[Performance Optimization](performance.md)** - Tips for better mining performance

## 🎯 What is MineMaster?

MineMaster is a desktop application that provides:

- **🖥️ Cross-Platform Support** - Works on Linux, Windows, and macOS
- **⚙️ Multi-Miner Management** - Control multiple miners (CPU & GPU) simultaneously
- **📊 Real-Time Monitoring** - View hashrates, system stats, and miner output
- **🎨 User-Friendly Interface** - Easy configuration without command-line complexity
- **🔄 Auto-Configuration** - Automatic miner binary downloads and setup

## 🏗️ Project Overview

### Technology Stack
- **Frontend**: React 18 with modern hooks
- **Desktop Framework**: Electron 28
- **Mining Software**: XMRig (CPU), Nanominer (GPU)
- **System Monitoring**: systeminformation library
- **Process Management**: Node.js child_process

### Supported Miners
1. **XMRig** - CPU mining for RandomX-based cryptocurrencies (Monero, Wownero, etc.)
2. **Nanominer** - GPU mining for various algorithms (Ethash, KawPow, Autolykos, etc.)

### Supported Algorithms

**CPU Mining (XMRig)**:
- RandomX (rx/0) - Monero (XMR)
- RandomWOW (rx/wow) - Wownero (WOW)
- RandomARQ (rx/arq) - ArQmA (ARQ)
- CryptoNight variants
- GhostRider - Raptoreum (RTM)

**GPU Mining (Nanominer)**:
- Ethash - Ethereum Classic (ETC), Ubiq (UBQ)
- Etchash - Ethereum Classic (ETC)
- KawPow - Ravencoin (RVN)
- Autolykos - Ergo (ERG)
- Octopus - Conflux (CFX)
- Kaspa - Kaspa (KAS)
- And more...

## 🚀 Quick Links

- **Main Project**: [MineMaster Client](../client/)
- **Source Code**: [GitHub Repository](https://github.com/xmrig/xmrig) (XMRig), [GitHub Repository](https://github.com/nanopool/nanominer) (Nanominer)
- **Issue Tracker**: Report issues in the project repository

## 📖 Learning Path

### For End Users
1. Read the [Installation Guide](installation.md)
2. Follow the [Quick Start](quick-start.md)
3. Refer to [User Guide](user-guide.md) for detailed usage
4. Check [Troubleshooting](troubleshooting.md) if you encounter issues

### For Developers
1. Review the [Architecture Overview](architecture.md)
2. Set up your development environment with [Development Guide](development.md)
3. Explore the [API Reference](api-reference.md)
4. Contribute to the project!

## 🔒 Security & Privacy

MineMaster:
- ✅ Does NOT collect any personal data
- ✅ Does NOT send mining data to external servers
- ✅ Stores all configuration locally
- ✅ Uses official miner binaries from trusted sources
- ⚠️ Wallet addresses and private keys are stored locally (keep them secure!)

## 📝 License

MineMaster uses multiple open-source components:
- **XMRig**: GPL-3.0 License
- **Nanominer**: Check official terms of use
- **Electron**: MIT License
- **React**: MIT License

## 🤝 Contributing

Contributions are welcome! Please read the [Development Guide](development.md) for details on our development process and how to submit pull requests.

## 💬 Support

Need help?
1. Check the [FAQ](faq.md)
2. Read the [Troubleshooting Guide](troubleshooting.md)
3. Review existing documentation
4. Search for similar issues in the issue tracker
5. Open a new issue if your problem isn't already documented

## 🌟 Credits

MineMaster is built on top of excellent open-source mining software:
- **XMRig Team** - For the powerful XMRig CPU miner
- **Nanopool Team** - For the versatile Nanominer GPU miner
- **Electron Community** - For the cross-platform desktop framework
- **React Team** - For the UI library

---

**Last Updated**: January 2026
**Version**: 1.0.0
