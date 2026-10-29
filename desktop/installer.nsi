Unicode true
!include "MUI2.nsh"
!define APPNAME "Devrantaş"
!define EXE "Devrantas.exe"
Name "${APPNAME}"
OutFile "Devrantas-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Devrantas"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_ICON "build\icon.ico"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Devrantaş'ı şimdi aç"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "out\Devrantas-win32-x64\*.*"
  CreateDirectory "$SMPROGRAMS\Devrantaş"
  CreateShortcut "$SMPROGRAMS\Devrantaş\Devrantaş.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\build\icon.ico"
  CreateShortcut "$DESKTOP\Devrantaş.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\app\build\icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Devrantas" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Devrantas" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Devrantas" "Publisher" "Devrantaş Yapı Mimarlık"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Devrantas" "DisplayIcon" "$INSTDIR\${EXE}"
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Devrantaş\Devrantaş.lnk"
  RMDir "$SMPROGRAMS\Devrantaş"
  Delete "$DESKTOP\Devrantaş.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Devrantas"
SectionEnd
