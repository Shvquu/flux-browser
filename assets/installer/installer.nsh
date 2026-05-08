# ============================================================
# installer.nsh – FLUX Browser Custom NSIS Macros
#
# WICHTIG: electron-builder setzt MUI2, MUI_HEADERIMAGE,
# MUI_WELCOMEFINISHPAGE_BITMAP etc. bereits selbst via
# Command-Line-Defines. Hier nur Makros definieren.
# ============================================================

# ── Windows Version Check ─────────────────────────────────
!macro customInit
  !include "WinVer.nsh"
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP|MB_OK \
      "FLUX Browser requires Windows 10 or later.$\nPlease update your system."
    Quit
  ${EndIf}
!macroend

# ── Branding Text ─────────────────────────────────────────
!macro customHeader
  BrandingText "FLUX Browser — Zero Telemetry · Zero Tracking · Full Control"
!macroend

# ── Nach der Installation ─────────────────────────────────
!macro customInstallEnd
  # Startmenü-Ordner anlegen
  CreateDirectory "$SMPROGRAMS\FLUX Browser"
  CreateShortCut  "$SMPROGRAMS\FLUX Browser\FLUX Browser.lnk" \
                  "$INSTDIR\FLUX Browser.exe"
  CreateShortCut  "$SMPROGRAMS\FLUX Browser\Uninstall.lnk" \
                  "$INSTDIR\Uninstall FLUX Browser.exe"
!macroend

# ── Nach der Deinstallation ───────────────────────────────
!macro customUnInstallEnd
  Delete    "$SMPROGRAMS\FLUX Browser\FLUX Browser.lnk"
  Delete    "$SMPROGRAMS\FLUX Browser\Uninstall.lnk"
  RMDir     "$SMPROGRAMS\FLUX Browser"
  Delete    "$DESKTOP\FLUX Browser.lnk"
!macroend
