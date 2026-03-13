module.exports = {
  packagerConfig: {
    name: 'FLUX Browser',
    executableName: 'flux-browser',
    icon: './renderer/flux',
  },
  makers: [
  // Windows – .exe Installer
  { name: '@electron-forge/maker-squirrel', config: { authors: 'Shvquu' } },

  // macOS – .dmg Installer (schönes Drag-to-Applications Fenster)
  { name: '@electron-forge/maker-dmg', config: { name: 'FLUX Browser' } },

  // Linux – .deb (Debian/Ubuntu)
  { name: '@electron-forge/maker-deb', config: { options: { maintainer: 'Shvquu', homepage: 'https://shvquu.de/flux' } } },

  // Linux – .rpm (Fedora/RedHat)
  { name: '@electron-forge/maker-rpm', config: { options: { maintainer: 'Shvquu' } } },
  ],
}