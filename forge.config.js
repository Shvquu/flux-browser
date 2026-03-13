module.exports = {
  packagerConfig: {
    name: 'FLUX Browser',
    executableName: 'flux-browser',
    icon: './renderer/flux',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'flux_browser',
        authors: 'Shvquu',          // ← das war das Problem
        description: 'Futuristischer Browser auf Electron-Basis',
        setupIcon: './renderer/flux.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
    },
  ],
}