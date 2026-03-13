module.exports = {
  packagerConfig: {
    name: 'FLUX Browser',
    executableName: 'flux-browser',
    icon: './renderer/flux',
  },
  makers: [
  // Windows – .exe Installer
  { name: '@electron-forge/maker-squirrel', config: { authors: 'FLUX Browser',  homepage: 'https://fluxprivacy.app/' } },

  // macOS – .dmg Installer (schönes Drag-to-Applications Fenster)
  { name: '@electron-forge/maker-dmg', config: { name: 'FLUX Browser',  homepage: 'https://fluxprivacy.app/' } },

  // Linux – .deb (Debian/Ubuntu)
  { name: '@electron-forge/maker-deb', config: { options: { maintainer: 'FLUX Browser', homepage: 'https://fluxprivacy.app/' } } },

  // Linux – .rpm (Fedora/RedHat)
  { name: '@electron-forge/maker-rpm', config: { options: { maintainer: 'FLUX Browser', homepage: 'https://fluxprivacy.app/' } } },
  ],
}